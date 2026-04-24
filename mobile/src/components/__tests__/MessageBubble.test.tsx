// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import { splitTextAndCode, Segment } from '../MessageBubble';

describe('splitTextAndCode', () => {
  it('returns single text segment for plain text', () => {
    const result = splitTextAndCode('Hello world');
    expect(result).toEqual([{ type: 'text', content: 'Hello world' }]);
  });

  it('extracts a fenced code block', () => {
    const input = 'before\n```ts\nconst x = 1;\n```\nafter';
    const result = splitTextAndCode(input);
    expect(result).toEqual<Segment[]>([
      { type: 'text', content: 'before' },
      { type: 'code', content: 'const x = 1;', language: 'ts' },
      { type: 'text', content: 'after' },
    ]);
  });

  it('handles code block without language', () => {
    const input = '```\nplain code\n```';
    const result = splitTextAndCode(input);
    expect(result).toEqual<Segment[]>([
      { type: 'code', content: 'plain code', language: undefined },
    ]);
  });

  it('handles multiple code blocks', () => {
    const input = 'a\n```js\nfoo()\n```\nb\n```py\nbar()\n```\nc';
    const result = splitTextAndCode(input);
    expect(result).toHaveLength(5);
    expect(result[0]).toEqual({ type: 'text', content: 'a' });
    expect(result[1]).toEqual({ type: 'code', content: 'foo()', language: 'js' });
    expect(result[2]).toEqual({ type: 'text', content: 'b' });
    expect(result[3]).toEqual({ type: 'code', content: 'bar()', language: 'py' });
    expect(result[4]).toEqual({ type: 'text', content: 'c' });
  });

  it('returns raw text as single segment when no fences found', () => {
    const result = splitTextAndCode('');
    expect(result).toEqual([{ type: 'text', content: '' }]);
  });
});
