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
}

export interface ApprovalPendingEvent {
  type: 'approval_pending';
  tool_use_id: string;
  tool_name: string;
  expires_at: number;
}

export interface SessionInfo {
  session_id: string;
  prompt: string;
  container?: string | null;
  started_at: number;
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
