import type { InstanceTab } from "../data/dashboardData";

export const instanceTabs = ["overview", "files", "runtime", "audit"] as const;
export const governanceSections = ["credentials", "members", "policy", "audit", "cost"] as const;

export type GovernanceSection = (typeof governanceSections)[number];

export const workspaceRoutes = {
  root: "/workspace",
  workshops: "/workspace/workshops",
  workshop: (workshopId: string) => `/workspace/workshops/${workshopId}`,
  service: (serviceId: string) => `/workspace/services/${serviceId}`,
  serviceBatch: (serviceId: string, batchJobId: string) =>
    `/workspace/services/${serviceId}/batches/${batchJobId}`,
  instances: "/workspace/instances",
  instance: (instanceId: string, tab: InstanceTab = "overview") =>
    tab === "overview"
      ? `/workspace/instances/${instanceId}`
      : `/workspace/instances/${instanceId}/${tab}`,
  settingsProviders: "/workspace/settings/providers",
  creator: "/workspace/creator",
  creatorPackage: (packageId: string) => `/workspace/creator/packages/${packageId}`,
  creatorDebug: (packageId: string) => `/workspace/creator/packages/${packageId}/debug`,
  creatorGovernance: (section: GovernanceSection = "credentials") =>
    `/workspace/creator/governance/${section}`,
};

export const adminConsoleUrl =
  import.meta.env.VITE_ADMIN_CONSOLE_URL?.trim() || "http://192.168.31.20:38140/";

export const dashboardRoutes = {
  ...workspaceRoutes,
  providers: workspaceRoutes.settingsProviders,
};

export const isInstanceTab = (value: string | undefined): value is InstanceTab =>
  Boolean(value && instanceTabs.includes(value as InstanceTab));

export const isGovernanceSection = (value: string | undefined): value is GovernanceSection =>
  Boolean(value && governanceSections.includes(value as GovernanceSection));
