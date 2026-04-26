import { useEffect, useState } from "react";
import { useApprovalStore } from "../store/approvalStore";
import { useConnectionStore } from "../store/connectionStore";

interface ApprovalBannerProps {
  toolUseId: string;
}

export function ApprovalBanner({ toolUseId }: ApprovalBannerProps) {
  const approval = useApprovalStore((s) =>
    s.pendingApprovals.find((a) => a.tool_use_id === toolUseId),
  );
  const ws = useConnectionStore((s) => s.ws);
  const removeApproval = useApprovalStore((s) => s.removeApproval);
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!approval?.expires_at) return;
    function tick() {
      const secs = Math.max(
        0,
        Math.floor(approval!.expires_at! - Date.now() / 1000),
      );
      setRemaining(secs);
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [approval?.expires_at]);

  if (!approval) return null;

  function handleDecision(allow: boolean) {
    ws.send({
      type: "input",
      tool_use_id: toolUseId,
      decision: allow ? "y" : "n",
    });
    removeApproval(toolUseId);
  }

  const isUrgent = approval.urgent || (remaining !== null && remaining <= 30);

  return (
    <div
      className={`ml-4 mt-1 flex items-center justify-between px-3 py-2 rounded-lg border transition-colors ${
        isUrgent
          ? "border-(--color-danger)/50 bg-(--color-danger)/10 animate-pulse"
          : "border-(--color-warning)/50 bg-(--color-warning)/10"
      }`}
    >
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium">Approve?</span>
        {remaining !== null && (
          <span
            className={`text-xs ${isUrgent ? "text-(--color-danger) font-medium" : "text-(--color-text-muted)"}`}
          >
            {remaining}s
          </span>
        )}
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => handleDecision(true)}
          className="px-3 py-1 text-xs font-medium rounded bg-(--color-success) text-white hover:opacity-90 transition-opacity"
        >
          Allow
        </button>
        <button
          onClick={() => handleDecision(false)}
          className="px-3 py-1 text-xs font-medium rounded bg-(--color-danger) text-white hover:opacity-90 transition-opacity"
        >
          Deny
        </button>
      </div>
    </div>
  );
}
