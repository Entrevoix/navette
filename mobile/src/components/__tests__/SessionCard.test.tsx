import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { SessionCard } from '../SessionCard';
import { SessionInfo } from '../../types';

// freeze time so elapsed calculations are deterministic
const NOW_S = 1_700_000_000;
beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW_S * 1000);
});
afterAll(() => {
  jest.useRealTimers();
});

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    session_id: 'abc123def456',
    prompt: 'Implement a new feature for testing',
    started_at: NOW_S - 120, // 2 minutes ago
    ...overrides,
  };
}

describe('SessionCard — rendering', () => {
  it('renders the prompt text', () => {
    const { getByText } = render(
      <SessionCard session={makeSession()} isActive={false} onSelect={jest.fn()} />,
    );
    expect(getByText('Implement a new feature for testing')).toBeTruthy();
  });

  it('truncates prompts longer than 60 characters', () => {
    const longPrompt = 'A'.repeat(70);
    const { getByText } = render(
      <SessionCard session={makeSession({ prompt: longPrompt })} isActive={false} onSelect={jest.fn()} />,
    );
    const expected = 'A'.repeat(60) + '…';
    expect(getByText(expected)).toBeTruthy();
  });

  it('does not truncate prompts of exactly 60 characters', () => {
    const prompt = 'B'.repeat(60);
    const { getByText } = render(
      <SessionCard session={makeSession({ prompt })} isActive={false} onSelect={jest.fn()} />,
    );
    expect(getByText(prompt)).toBeTruthy();
  });

  it('shows "Claude" as the default agent label', () => {
    const { getByText } = render(
      <SessionCard session={makeSession()} isActive={false} onSelect={jest.fn()} />,
    );
    expect(getByText('Claude')).toBeTruthy();
  });

  it('shows elapsed time formatted as minutes and seconds', () => {
    const { getByText } = render(
      <SessionCard session={makeSession()} isActive={false} onSelect={jest.fn()} />,
    );
    // started_at is 120s ago → 2m 0s
    expect(getByText('2m 0s')).toBeTruthy();
  });

  it('shows elapsed time in seconds when under 60 seconds', () => {
    const { getByText } = render(
      <SessionCard
        session={makeSession({ started_at: NOW_S - 45 })}
        isActive={false}
        onSelect={jest.fn()}
      />,
    );
    expect(getByText('45s')).toBeTruthy();
  });

  it('renders container name when provided', () => {
    const { getByText } = render(
      <SessionCard
        session={makeSession({ container: 'my-container' })}
        isActive={false}
        onSelect={jest.fn()}
      />,
    );
    expect(getByText('my-container')).toBeTruthy();
  });

  it('does not render container element when container is absent', () => {
    const { queryByText } = render(
      <SessionCard session={makeSession({ container: null })} isActive={false} onSelect={jest.fn()} />,
    );
    expect(queryByText('my-container')).toBeNull();
  });
});

describe('SessionCard — token display', () => {
  it('does not show token counts when both are zero / absent', () => {
    const { queryByText } = render(
      <SessionCard session={makeSession()} isActive={false} onSelect={jest.fn()} />,
    );
    expect(queryByText(/↑/)).toBeNull();
    expect(queryByText(/↓/)).toBeNull();
  });

  it('shows formatted input and output tokens', () => {
    const { getByText } = render(
      <SessionCard
        session={makeSession({ input_tokens: 1500, output_tokens: 450 })}
        isActive={false}
        onSelect={jest.fn()}
      />,
    );
    // ↑1.5k ↓450
    expect(getByText('↑1.5k ↓450')).toBeTruthy();
  });

  it('formats tokens in millions when >= 1,000,000', () => {
    const { getByText } = render(
      <SessionCard
        session={makeSession({ input_tokens: 2_000_000, output_tokens: 1_500_000 })}
        isActive={false}
        onSelect={jest.fn()}
      />,
    );
    expect(getByText('↑2.0M ↓1.5M')).toBeTruthy();
  });

  it('shows token row when only input_tokens is present', () => {
    const { getByText } = render(
      <SessionCard
        session={makeSession({ input_tokens: 800 })}
        isActive={false}
        onSelect={jest.fn()}
      />,
    );
    expect(getByText('↑800 ↓0')).toBeTruthy();
  });
});

describe('SessionCard — interaction', () => {
  it('calls onSelect with session_id when tapped', () => {
    const onSelect = jest.fn();
    const { getByText } = render(
      <SessionCard session={makeSession()} isActive={false} onSelect={onSelect} />,
    );
    fireEvent.press(getByText('Implement a new feature for testing'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('abc123def456');
  });

  it('calls onSelect with the correct session_id for different sessions', () => {
    const onSelect = jest.fn();
    const { getByText } = render(
      <SessionCard
        session={makeSession({ session_id: 'xyz789', prompt: 'Another task' })}
        isActive={false}
        onSelect={onSelect}
      />,
    );
    fireEvent.press(getByText('Another task'));
    expect(onSelect).toHaveBeenCalledWith('xyz789');
  });
});

describe('SessionCard — elapsed timer', () => {
  it('updates elapsed time after 1 second interval', () => {
    const { getByText } = render(
      <SessionCard
        session={makeSession({ started_at: NOW_S - 59 })}
        isActive={true}
        onSelect={jest.fn()}
      />,
    );
    expect(getByText('59s')).toBeTruthy();
    act(() => { jest.advanceTimersByTime(1000); });
    expect(getByText('1m 0s')).toBeTruthy();
  });
});
