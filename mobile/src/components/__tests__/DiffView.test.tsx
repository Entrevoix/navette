import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { DiffView } from '../DiffView';

const SIMPLE_DIFF = `--- a/file.txt\n+++ b/file.txt\n@@ -1,3 +1,4 @@\n context\n+added line\n-removed line\n`;

describe('DiffView — rendering guards', () => {
  it('returns null for empty content', () => {
    const { toJSON } = render(<DiffView content="" />);
    expect(toJSON()).toBeNull();
  });

  it('returns null when content has no diff markers', () => {
    const { toJSON } = render(<DiffView content="just some plain text\nno markers here" />);
    expect(toJSON()).toBeNull();
  });

  it('renders when content contains @@ hunk header', () => {
    const { getByText } = render(<DiffView content={SIMPLE_DIFF} />);
    expect(getByText(/Diff/)).toBeTruthy();
  });
});

describe('DiffView — stats', () => {
  it('shows correct added count', () => {
    const { getByText } = render(<DiffView content={SIMPLE_DIFF} />);
    expect(getByText('+1')).toBeTruthy();
  });

  it('shows correct removed count', () => {
    const { getByText } = render(<DiffView content={SIMPLE_DIFF} />);
    expect(getByText('-1')).toBeTruthy();
  });

  it('does not render added stat when there are no added lines', () => {
    const diff = `--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-only removed\n`;
    const { queryByText } = render(<DiffView content={diff} />);
    // removed stat present
    expect(queryByText('-1')).toBeTruthy();
    // added stat absent
    expect(queryByText(/^\+\d/)).toBeNull();
  });

  it('does not render removed stat when there are no removed lines', () => {
    const diff = `--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n+only added\n`;
    const { queryByText } = render(<DiffView content={diff} />);
    expect(queryByText('+1')).toBeTruthy();
    expect(queryByText(/^-\d/)).toBeNull();
  });

  it('counts multiple added and removed lines correctly', () => {
    const diff = [
      '--- a/file.txt',
      '+++ b/file.txt',
      '@@ -1,5 +1,6 @@',
      ' context',
      '+line a',
      '+line b',
      '+line c',
      '-gone1',
      '-gone2',
    ].join('\n');
    const { getByText } = render(<DiffView content={diff} />);
    expect(getByText('+3')).toBeTruthy();
    expect(getByText('-2')).toBeTruthy();
  });

  it('does not count +++ or --- file headers as added/removed', () => {
    // A diff with only file headers and a hunk header — no actual changed lines
    const diff = `--- a/file.txt\n+++ b/file.txt\n@@ -0,0 +1 @@\n`;
    const { queryByText } = render(<DiffView content={diff} />);
    // +++ and --- are excluded; hunk triggers render but no stat lines
    expect(queryByText(/^\+\d/)).toBeNull();
    expect(queryByText(/^-\d/)).toBeNull();
  });
});

describe('DiffView — expand / collapse toggle', () => {
  it('starts collapsed (no line content visible)', () => {
    const { queryByText } = render(<DiffView content={SIMPLE_DIFF} />);
    expect(queryByText('added line')).toBeNull();
    expect(queryByText('removed line')).toBeNull();
  });

  it('shows collapse indicator ▼ when expanded', () => {
    const { getByText } = render(<DiffView content={SIMPLE_DIFF} />);
    fireEvent.press(getByText(/Diff/));
    expect(getByText(/▼/)).toBeTruthy();
  });

  it('shows expand indicator ▶ when collapsed', () => {
    const { getByText } = render(<DiffView content={SIMPLE_DIFF} />);
    expect(getByText(/▶/)).toBeTruthy();
  });

  it('reveals diff lines after pressing header', () => {
    const { getByText } = render(<DiffView content={SIMPLE_DIFF} />);
    fireEvent.press(getByText(/Diff/));
    // Lines render with their +/- prefix characters intact
    expect(getByText('+added line')).toBeTruthy();
    expect(getByText('-removed line')).toBeTruthy();
  });

  it('hides diff lines again after pressing header twice', () => {
    const { getByText, queryByText } = render(<DiffView content={SIMPLE_DIFF} />);
    fireEvent.press(getByText(/Diff/));
    fireEvent.press(getByText(/Diff/));
    expect(queryByText('+added line')).toBeNull();
  });
});
