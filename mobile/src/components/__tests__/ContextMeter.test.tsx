// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { render } from '@testing-library/react-native';
import { ContextMeter } from '../ContextMeter';

describe('ContextMeter', () => {
  it('shows 0% when no tokens used', () => {
    const { getByText } = render(
      <ContextMeter inputTokens={0} outputTokens={0} cacheTokens={0} maxTokens={200_000} />
    );
    expect(getByText('0/200k (0%)')).toBeTruthy();
  });

  it('shows correct percentage', () => {
    const { getByText } = render(
      <ContextMeter inputTokens={100_000} outputTokens={50_000} cacheTokens={0} maxTokens={200_000} />
    );
    expect(getByText('150k/200k (75%)')).toBeTruthy();
  });

  it('caps at 100%', () => {
    const { getByText } = render(
      <ContextMeter inputTokens={250_000} outputTokens={0} cacheTokens={0} maxTokens={200_000} />
    );
    expect(getByText(/100%/)).toBeTruthy();
  });

  it('handles zero maxTokens without crash', () => {
    const { getByText } = render(
      <ContextMeter inputTokens={0} outputTokens={0} cacheTokens={0} maxTokens={0} />
    );
    expect(getByText(/0%/)).toBeTruthy();
  });
});
