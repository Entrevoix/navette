// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { render } from '@testing-library/react-native';
import { CodeBlock } from '../CodeBlock';

describe('CodeBlock', () => {
  it('renders code lines', () => {
    const { getByText } = render(<CodeBlock code="const x = 1;" language="ts" />);
    expect(getByText(/const/)).toBeTruthy();
  });

  it('renders language label when provided', () => {
    const { getByText } = render(<CodeBlock code="hello" language="rust" />);
    expect(getByText('rust')).toBeTruthy();
  });

  it('renders copy button', () => {
    const { getByText } = render(<CodeBlock code="fn main() {}" />);
    expect(getByText('Copy')).toBeTruthy();
  });

  it('handles empty code', () => {
    const { getByText } = render(<CodeBlock code="" />);
    expect(getByText('Copy')).toBeTruthy();
  });

  it('handles multi-line code', () => {
    const code = 'line 1\nline 2\nline 3';
    const { getAllByText } = render(<CodeBlock code={code} />);
    expect(getAllByText(/line/).length).toBeGreaterThanOrEqual(1);
  });
});
