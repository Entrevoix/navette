import { describe, it, expect, beforeEach } from "vitest";
import { useApprovalStore } from "../approvalStore";
import type { PendingApproval, ApprovalPolicy } from "../../types/index";

function makeApproval(id: string): PendingApproval {
  return {
    tool_use_id: id,
    tool_name: "Bash",
    tool_input: { command: "ls" },
    seq: 1,
  };
}

function makePolicy(toolName: string): ApprovalPolicy {
  const now = Date.now() / 1000;
  return {
    tool_name: toolName,
    action: "allow",
    created_at: now,
    updated_at: now,
  };
}

beforeEach(() => {
  useApprovalStore.setState({
    pendingApprovals: [],
    approvalPolicies: [],
  });
});

describe("approvalStore", () => {
  it("addApproval adds to pendingApprovals", () => {
    const approval = makeApproval("id1");
    useApprovalStore.getState().addApproval(approval);
    expect(useApprovalStore.getState().pendingApprovals).toHaveLength(1);
    expect(useApprovalStore.getState().pendingApprovals[0].tool_use_id).toBe("id1");
  });

  it("addApproval appends without removing existing approvals", () => {
    useApprovalStore.getState().addApproval(makeApproval("id1"));
    useApprovalStore.getState().addApproval(makeApproval("id2"));
    expect(useApprovalStore.getState().pendingApprovals).toHaveLength(2);
  });

  it("removeApproval removes by tool_use_id", () => {
    useApprovalStore.getState().addApproval(makeApproval("id1"));
    useApprovalStore.getState().addApproval(makeApproval("id2"));
    useApprovalStore.getState().removeApproval("id1");
    const approvals = useApprovalStore.getState().pendingApprovals;
    expect(approvals).toHaveLength(1);
    expect(approvals[0].tool_use_id).toBe("id2");
  });

  it("removeApproval is a no-op when id does not exist", () => {
    useApprovalStore.getState().addApproval(makeApproval("id1"));
    useApprovalStore.getState().removeApproval("nonexistent");
    expect(useApprovalStore.getState().pendingApprovals).toHaveLength(1);
  });

  it("markUrgent sets urgent flag on the matching approval", () => {
    useApprovalStore.getState().addApproval(makeApproval("id1"));
    useApprovalStore.getState().markUrgent("id1");
    expect(useApprovalStore.getState().pendingApprovals[0].urgent).toBe(true);
  });

  it("markUrgent does not affect other approvals", () => {
    useApprovalStore.getState().addApproval(makeApproval("id1"));
    useApprovalStore.getState().addApproval(makeApproval("id2"));
    useApprovalStore.getState().markUrgent("id1");
    expect(useApprovalStore.getState().pendingApprovals[1].urgent).toBeUndefined();
  });

  it("clearApprovals empties the list", () => {
    useApprovalStore.getState().addApproval(makeApproval("id1"));
    useApprovalStore.getState().clearApprovals();
    expect(useApprovalStore.getState().pendingApprovals).toHaveLength(0);
  });

  it("setPolicies replaces approvalPolicies", () => {
    const policies = [makePolicy("Bash"), makePolicy("Read")];
    useApprovalStore.getState().setPolicies(policies);
    expect(useApprovalStore.getState().approvalPolicies).toHaveLength(2);
  });

  it("setPolicy adds a new policy when tool name is not present", () => {
    useApprovalStore.getState().setPolicy("Bash", "allow");
    const policies = useApprovalStore.getState().approvalPolicies;
    expect(policies).toHaveLength(1);
    expect(policies[0].tool_name).toBe("Bash");
    expect(policies[0].action).toBe("allow");
  });

  it("setPolicy updates existing policy action when tool name already exists", () => {
    useApprovalStore.getState().setPolicy("Bash", "allow");
    useApprovalStore.getState().setPolicy("Bash", "deny");
    const policies = useApprovalStore.getState().approvalPolicies;
    expect(policies).toHaveLength(1);
    expect(policies[0].action).toBe("deny");
  });

  it("removePolicy removes by tool name", () => {
    useApprovalStore.getState().setPolicy("Bash", "allow");
    useApprovalStore.getState().setPolicy("Read", "deny");
    useApprovalStore.getState().removePolicy("Bash");
    const policies = useApprovalStore.getState().approvalPolicies;
    expect(policies).toHaveLength(1);
    expect(policies[0].tool_name).toBe("Read");
  });
});
