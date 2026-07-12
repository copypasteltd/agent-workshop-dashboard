import type { InstanceTab } from "../data/dashboardData";

export const instanceTabs = ["overview", "files", "runtime", "audit"] as const;
export const governanceSections = ["credentials", "members", "policy", "audit", "cost"] as const;

export type GovernanceSection = (typeof governanceSections)[number];

export const dashboardRoutes = {
  workshops: "/dashboard/workshops",
  workshop: (workshopId: string) => `/dashboard/workshops/${workshopId}`,
  service: (serviceId: string) => `/dashboard/services/${serviceId}`,
  serviceBatch: (serviceId: string, batchJobId: string) =>
    `/dashboard/services/${serviceId}/batches/${batchJobId}`,
  instances: "/dashboard/instances",
  instance: (instanceId: string, tab: InstanceTab = "overview") =>
    tab === "overview" ? `/dashboard/instances/${instanceId}` : `/dashboard/instances/${instanceId}/${tab}`,
  creator: "/dashboard/creator",
  creatorPackage: (packageId: string) => `/dashboard/creator/packages/${packageId}`,
  creatorDebug: (packageId: string) => `/dashboard/creator/packages/${packageId}/debug`,
  creatorGovernance: (section: GovernanceSection = "credentials") => `/dashboard/creator/governance/${section}`,
};

export const isInstanceTab = (value: string | undefined): value is InstanceTab =>
  Boolean(value && instanceTabs.includes(value as InstanceTab));

export const isGovernanceSection = (value: string | undefined): value is GovernanceSection =>
  Boolean(value && governanceSections.includes(value as GovernanceSection));
