// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

export interface EventFrame {
  seq: number;
  ts: number;
  event: ClaudeEvent;
}

export type ClaudeEvent =
  | SystemEvent
  | AssistantEvent
  | ToolResultEvent
  | ResultEvent
  | UnknownEvent;

export interface SystemEvent {
  type: 'system';
  subtype: string;
  session_id?: string;
}

export interface AssistantEvent {
  type: 'assistant';
  message: {
    content: ContentBlock[];
  };
}

export type ContentBlock = TextBlock | ToolUseBlock;

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultEvent {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
}

export interface ResultEvent {
  type: 'result';
  subtype: string;
  result?: string;
}

export interface UnknownEvent {
  type: string;
  [key: string]: unknown;
}

export interface PendingApproval {
  tool_use_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  seq: number;
  expires_at?: number;
  urgent?: boolean;
}

export interface ApprovalPendingEvent {
  type: 'approval_pending';
  tool_use_id: string;
  tool_name: string;
  expires_at: number;
}

export interface ApprovalWarningEvent {
  type: 'approval_warning';
  tool_use_id: string;
  seconds_remaining: number;
  session_id?: string;
}

export interface SessionInfo {
  session_id: string;
  prompt: string;
  container?: string | null;
  started_at: number;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'authenticating' | 'connected' | 'error';

export type SessionStatus = 'idle' | 'running';

export interface ServerConfig {
  host: string;
  port: string;
  token: string;
  container?: string;
}

export interface DirEntry {
  name: string;
  is_dir: boolean;
}

export interface DirListingEvent {
  type: 'dir_listing';
  path: string;
  entries: DirEntry[];
  error?: string;
}

export interface PastSessionInfo {
  session_id: string;
  event_count: number;
  started_at: number;
  last_event: number;
}

export interface ScheduledSessionInfo {
  id: string;
  prompt: string;
  container?: string | null;
  command?: string | null;
  scheduled_at: number;
  created_at: number;
  fired: boolean;
}

export interface TestNotificationSentEvent {
  type: 'test_notification_sent';
  ok: boolean;
  error?: string;
}

export interface SavedPrompt {
  id: string;
  title: string;
  body: string;
  tags: string[];
  created_at: number;
  updated_at: number;
}

export interface SecretEntry {
  name: string;
  masked: string;
  created_at: number;
  updated_at: number;
}

export interface FileContentEvent {
  type: 'file_content';
  path: string;
  content?: string;
  size?: number;
  error?: string;
}

export interface FileWriteResultEvent {
  type: 'file_written';
  path: string;
  ok: boolean;
  error?: string;
}
