import { useConnectionStore } from "../store/connectionStore";
import { useSessionStore } from "../store/sessionStore";
import { useApprovalStore } from "../store/approvalStore";
import { useFeatureStore } from "../store/featureStore";
import type {
  ApprovalPolicy,
  ContainerInfo,
  DeviceEntry,
  EventFrame,
  McpServerInfo,
  PastSessionInfo,
  PendingApproval,
  SavedPrompt,
  ScheduledSessionInfo,
  SearchResult,
  SecretEntry,
  SessionInfo,
  SkillInfo,
} from "../types";

export function setupDispatch() {
  const ws = useConnectionStore.getState().ws;

  return ws.onMessage((msg) => {
    const type = msg.type as string;

    switch (type) {
      case "welcome": {
        const sessions = (msg.sessions as SessionInfo[]) || [];
        useSessionStore.getState().setSessions(sessions);
        break;
      }

      case "session_started":
      case "session_list_changed": {
        const sessions = (msg.sessions as SessionInfo[]) || [];
        useSessionStore.getState().setSessions(sessions);
        break;
      }

      case "run_accepted": {
        const sessionId = msg.session_id as string;
        useSessionStore.getState().setActiveSessionId(sessionId);
        break;
      }

      case "session_ended": {
        const sessions = (msg.sessions as SessionInfo[]) || [];
        if (sessions.length > 0) {
          useSessionStore.getState().setSessions(sessions);
        }
        addEventFrame(msg);
        break;
      }

      case "assistant":
      case "tool_result":
      case "user":
      case "result":
      case "system": {
        addEventFrame(msg);
        break;
      }

      case "approval_pending": {
        const approval: PendingApproval = {
          tool_use_id: msg.tool_use_id as string,
          tool_name: msg.tool_name as string,
          tool_input: (msg.tool_input as Record<string, unknown>) || {},
          seq: (msg.seq as number) || 0,
          expires_at: msg.expires_at as number | undefined,
        };
        useApprovalStore.getState().addApproval(approval);
        addEventFrame(msg);
        break;
      }

      case "approval_warning": {
        const toolUseId = msg.tool_use_id as string;
        useApprovalStore.getState().markUrgent(toolUseId);
        break;
      }

      case "approval_expired": {
        const toolUseId = msg.tool_use_id as string;
        useApprovalStore.getState().removeApproval(toolUseId);
        break;
      }

      case "dir_listing":
      case "file_content":
      case "file_written":
      case "dir_created":
        break;

      case "skills_list":
        useFeatureStore
          .getState()
          .setSkills((msg.skills as SkillInfo[]) || []);
        break;

      case "past_sessions_list":
        useFeatureStore
          .getState()
          .setPastSessions(
            (msg.sessions as PastSessionInfo[]) || [],
          );
        break;

      case "session_history": {
        const sid = msg.session_id as string;
        const events = (msg.events as EventFrame[]) || [];
        useFeatureStore.getState().setSessionHistory(sid, events);
        break;
      }

      case "search_results":
        useFeatureStore
          .getState()
          .setSearchResults(
            (msg.sessions as SearchResult[]) || [],
          );
        break;

      case "prompts_list":
        useFeatureStore
          .getState()
          .setSavedPrompts(
            (msg.prompts as SavedPrompt[]) || [],
          );
        break;

      case "prompt_saved":
      case "prompt_updated":
      case "prompt_deleted":
        ws.send({ type: "list_prompts" });
        break;

      case "secrets_list":
        useFeatureStore
          .getState()
          .setSecrets((msg.secrets as SecretEntry[]) || []);
        break;

      case "secret_saved":
      case "secret_deleted":
        ws.send({ type: "list_secrets" });
        break;

      case "scheduled_sessions_list":
        useFeatureStore
          .getState()
          .setScheduledSessions(
            (msg.sessions as ScheduledSessionInfo[]) || [],
          );
        break;

      case "session_scheduled":
      case "scheduled_session_cancelled":
      case "scheduled_session_fired":
        ws.send({ type: "list_scheduled_sessions" });
        break;

      case "devices_list":
        useFeatureStore
          .getState()
          .setDevices((msg.devices as DeviceEntry[]) || []);
        break;

      case "device_revoked":
      case "device_renamed":
        ws.send({ type: "list_devices" });
        break;

      case "approval_policies_list":
        useApprovalStore
          .getState()
          .setPolicies(
            (msg.policies as ApprovalPolicy[]) || [],
          );
        break;

      case "approval_policy_set":
      case "approval_policy_deleted":
        ws.send({ type: "get_approval_policies" });
        break;

      case "containers_list":
        useFeatureStore
          .getState()
          .setContainers(
            (msg.containers as ContainerInfo[]) || [],
          );
        break;

      case "mcp_servers_list":
        useFeatureStore
          .getState()
          .setMcpServers((msg.servers as McpServerInfo[]) || []);
        break;

      case "notify_config":
        useFeatureStore.getState().setNotifyConfig({
          topic: msg.topic as string,
          base_url: msg.base_url as string,
        });
        break;

      case "test_notification_sent":
        useFeatureStore
          .getState()
          .setTestNotificationResult(msg.ok ? "sent" : "failed");
        break;

      case "token_usage":
        break;
    }
  });
}

function addEventFrame(msg: Record<string, unknown>) {
  const seq = msg.seq as number | undefined;
  const ts = msg.ts as number | undefined;
  if (typeof seq !== "number") return;

  const event = { ...msg };
  delete event.seq;
  delete event.ts;

  useSessionStore.getState().addEvent({
    seq,
    ts: ts || Date.now() / 1000,
    event: event as EventFrame["event"],
  });
}
