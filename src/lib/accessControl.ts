import type { WorkspaceMembershipStatus, WorkspaceRole } from "@lingban/contracts";
import type { DashboardAuthMode } from "../stores/dashboardAuthStore";
import type { DashboardWorkspaceView } from "./workspaceContext";

export type CreatorAccessReason =
  | "preview"
  | "allowed"
  | "unauthenticated"
  | "membership-suspended"
  | "role-forbidden";

export type CreatorAccessState = {
  canAccessCreator: boolean;
  canManageCreatorGovernance: boolean;
  reason: CreatorAccessReason;
};

const creatorWorkspaceRoles = new Set<WorkspaceRole>(["owner", "admin", "creator"]);
const creatorGovernanceRoles = new Set<WorkspaceRole>(["owner", "admin"]);

function isMembershipActive(status: WorkspaceMembershipStatus | null) {
  return status == null || status === "active";
}

export function resolveCreatorAccessState(input: {
  authMode: DashboardAuthMode;
  authenticated: boolean;
  workspace: Pick<DashboardWorkspaceView, "role" | "membershipStatus">;
}): CreatorAccessState {
  const { authMode, authenticated, workspace } = input;

  if (authMode !== "required") {
    return {
      canAccessCreator: true,
      canManageCreatorGovernance: true,
      reason: "preview",
    };
  }

  if (!authenticated) {
    return {
      canAccessCreator: false,
      canManageCreatorGovernance: false,
      reason: "unauthenticated",
    };
  }

  if (!isMembershipActive(workspace.membershipStatus)) {
    return {
      canAccessCreator: false,
      canManageCreatorGovernance: false,
      reason: "membership-suspended",
    };
  }

  const role = workspace.role;
  if (role && creatorWorkspaceRoles.has(role)) {
    return {
      canAccessCreator: true,
      canManageCreatorGovernance: creatorGovernanceRoles.has(role),
      reason: "allowed",
    };
  }

  return {
    canAccessCreator: false,
    canManageCreatorGovernance: false,
    reason: "role-forbidden",
  };
}

export function isCreatorGovernanceTarget(target: string) {
  return (
    target === "governance-policy" ||
    target === "governance-audit" ||
    target === "governance-cost"
  );
}
