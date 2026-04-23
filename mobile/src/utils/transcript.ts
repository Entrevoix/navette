// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import { AssistantEvent, EventFrame, TextBlock, ToolUseBlock } from '../types';

const MAX_RESULT_LENGTH = 10_000;
const MAX_EVENTS_FOR_EXPORT = 500;

export function copyMessageText(event: EventFrame['event']): string {
  if (event.type !== 'assistant') return '';
  const ae = event as AssistantEvent;
  return ae.message.content
    .filter((b): b is TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('\n');
}

export function exportTranscriptMarkdown(events: EventFrame[], sessionId: string): string {
  const capped = events.slice(0, MAX_EVENTS_FOR_EXPORT);
  const lines: string[] = [`# Session ${sessionId}`, ''];

  for (const frame of capped) {
    const ev = frame.event;

    if (ev.type === 'session_started') {
      const s = ev as { type: string; prompt?: string };
      if (s.prompt) {
        lines.push('## User', '', s.prompt, '');
      }
      continue;
    }

    if (ev.type === 'session_ended') {
      const e = ev as { type: string; ok: boolean };
      lines.push(`---`, '', `*Session ${e.ok ? 'completed' : 'failed'}*`, '');
      continue;
    }

    if (ev.type === 'assistant') {
      const ae = ev as AssistantEvent;
      for (const block of ae.message.content) {
        if (block.type === 'text') {
          const tb = block as TextBlock;
          if (tb.text.trim()) {
            lines.push('## Assistant', '', tb.text, '');
          }
        } else if (block.type === 'tool_use') {
          const tu = block as ToolUseBlock;
          lines.push(`### Tool: ${tu.name}`, '', '```json', JSON.stringify(tu.input, null, 2), '```', '');
        }
      }
      continue;
    }

    if (ev.type === 'tool_result') {
      const tr = ev as { type: string; content: string };
      const content = String(tr.content ?? '');
      const truncated = content.length > MAX_RESULT_LENGTH
        ? content.slice(0, MAX_RESULT_LENGTH) + '\n…[truncated]'
        : content;
      lines.push('### Result', '', '```', truncated, '```', '');
    }
  }

  if (events.length > MAX_EVENTS_FOR_EXPORT) {
    lines.push(`*…${events.length - MAX_EVENTS_FOR_EXPORT} more events omitted*`);
  }

  return lines.join('\n');
}
