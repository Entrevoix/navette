// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { render } from '@testing-library/react-native';
import { StatusBar } from '../StatusBar';

describe('StatusBar', () => {
  const baseProps = {
    agentName: 'claude',
    containerName: null,
    inputTokens: 0,
    outputTokens: 0,
    cacheTokens: 0,
    maxTokens: 200_000,
    sessionRunning: false,
  };

  it('shows agent name', () => {
    const { getByText } = render(<StatusBar {...baseProps} />);
    expect(getByText('claude')).toBeTruthy();
  });

  it('shows "host" when no container', () => {
    const { getByText } = render(<StatusBar {...baseProps} />);
    expect(getByText('host')).toBeTruthy();
  });

  it('shows container name when provided', () => {
    const { getByText } = render(<StatusBar {...baseProps} containerName="devbox" />);
    expect(getByText('devbox')).toBeTruthy();
  });

  it('shows "idle" when not running', () => {
    const { getByText } = render(<StatusBar {...baseProps} sessionRunning={false} />);
    expect(getByText('idle')).toBeTruthy();
  });

  it('shows context meter when running', () => {
    const { getByText } = render(
      <StatusBar {...baseProps} sessionRunning={true} inputTokens={100_000} outputTokens={50_000} />
    );
    expect(getByText(/150k/)).toBeTruthy();
  });
});
