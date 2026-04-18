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
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'authenticating' | 'connected' | 'error';

export interface ServerConfig {
  host: string;
  port: string;
  token: string;
}
