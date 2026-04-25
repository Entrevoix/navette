// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import { structuredPatch } from 'diff';

export type DiffLineType = 'add' | 'remove' | 'context';
export interface DiffLine {
  type: DiffLineType;
  text: string;
}

export function computeDiff(oldText: string, newText: string): DiffLine[] {
  const patch = structuredPatch('', '', oldText, newText, '', '', { context: 3 });
  const lines: DiffLine[] = [];
  for (const hunk of patch.hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+')) {
        lines.push({ type: 'add', text: line.slice(1) });
      } else if (line.startsWith('-')) {
        lines.push({ type: 'remove', text: line.slice(1) });
      } else {
        lines.push({ type: 'context', text: line.slice(1) });
      }
    }
  }
  return lines;
}

export function toolInputToDiff(
  toolName: string,
  input: Record<string, unknown>,
): DiffLine[] | null {
  if (toolName === 'Edit' || toolName === 'MultiEdit') {
    const old = typeof input.old_string === 'string' ? input.old_string : '';
    const next = typeof input.new_string === 'string' ? input.new_string : '';
    if (!old && !next) return null;
    return computeDiff(old, next);
  }
  if (toolName === 'Write') {
    const content = typeof input.content === 'string' ? input.content : '';
    if (!content) return null;
    return content.split('\n').map((text: string) => ({ type: 'add' as const, text }));
  }
  return null;
}
