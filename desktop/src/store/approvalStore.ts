import { create } from "zustand";
import type { ApprovalPolicy, PendingApproval, PolicyAction } from "../types";

interface ApprovalState {
  pendingApprovals: PendingApproval[];
  approvalPolicies: ApprovalPolicy[];

  addApproval: (approval: PendingApproval) => void;
  removeApproval: (toolUseId: string) => void;
  markUrgent: (toolUseId: string) => void;
  clearApprovals: () => void;
  setPolicies: (policies: ApprovalPolicy[]) => void;
  setPolicy: (toolName: string, action: PolicyAction) => void;
  removePolicy: (toolName: string) => void;
}

export const useApprovalStore = create<ApprovalState>()((set, get) => ({
  pendingApprovals: [],
  approvalPolicies: [],

  addApproval(approval: PendingApproval) {
    set((state) => ({
      pendingApprovals: [...state.pendingApprovals, approval],
    }));
  },

  removeApproval(toolUseId: string) {
    set((state) => ({
      pendingApprovals: state.pendingApprovals.filter(
        (a) => a.tool_use_id !== toolUseId,
      ),
    }));
  },

  markUrgent(toolUseId: string) {
    set((state) => ({
      pendingApprovals: state.pendingApprovals.map((a) =>
        a.tool_use_id === toolUseId ? { ...a, urgent: true } : a,
      ),
    }));
  },

  clearApprovals() {
    set({ pendingApprovals: [] });
  },

  setPolicies(policies: ApprovalPolicy[]) {
    set({ approvalPolicies: policies });
  },

  setPolicy(toolName: string, action: PolicyAction) {
    const policies = get().approvalPolicies;
    const now = Date.now() / 1000;
    const idx = policies.findIndex((p) => p.tool_name === toolName);
    if (idx >= 0) {
      const updated = [...policies];
      updated[idx] = { ...updated[idx], action, updated_at: now };
      set({ approvalPolicies: updated });
    } else {
      set({
        approvalPolicies: [
          ...policies,
          { tool_name: toolName, action, created_at: now, updated_at: now },
        ],
      });
    }
  },

  removePolicy(toolName: string) {
    set((state) => ({
      approvalPolicies: state.approvalPolicies.filter(
        (p) => p.tool_name !== toolName,
      ),
    }));
  },
}));
