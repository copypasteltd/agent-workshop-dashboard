import type { CreateRunInput } from "@lingban/contracts";
import { dashboardServices } from "../data/dashboardData";

type DashboardRunTemplate = {
  workspaceId: string;
  taskVersionId: string;
  sessionVersionId: string;
  title: string;
  targetRoot: string;
  bindings: CreateRunInput["bindings"];
};

const dashboardRunTemplates: Record<string, DashboardRunTemplate> = {
  "tax-filing": {
    workspaceId: "wsp_harbor_finance",
    taskVersionId: "tsv_tax_filing",
    sessionVersionId: "sev_chrome_tax_runner",
    title: "香港有限公司季度报税",
    targetRoot: "/workspace/runs/tax-filing",
    bindings: {
      firstPartyMcpIds: ["mcp.browser.playwright"],
      externalConnectorRefs: ["workspace:notion-sse"],
      credentialIds: ["cred_browser_storage_state", "cred_tax_notice_folder"],
    },
  },
  "drama-storyboard": {
    workspaceId: "wsp_brand_content",
    taskVersionId: "tsv_drama_storyboard",
    sessionVersionId: "sev_creator_drama_suite",
    title: "短剧分镜生成与审校",
    targetRoot: "/workspace/runs/drama-storyboard",
    bindings: {
      firstPartyMcpIds: ["mcp.image.gpt-image-2"],
      externalConnectorRefs: ["workspace:seedance-api", "third-party:figma-mcp"],
      credentialIds: ["cred_openai_image_api_key", "cred_seedance_api_key", "cred_figma_pat"],
    },
  },
  "poster-batch": {
    workspaceId: "wsp_brand_content",
    taskVersionId: "tsv_poster_batch",
    sessionVersionId: "sev_brand_poster_suite",
    title: "品牌海报批量生成",
    targetRoot: "/workspace/runs/poster-batch",
    bindings: {
      firstPartyMcpIds: ["mcp.image.gpt-image-2"],
      externalConnectorRefs: ["third-party:asset-library"],
      credentialIds: ["cred_openai_image_api_key", "cred_asset_library_api_key"],
    },
  },
};

function buildRunSuffix() {
  return new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}

export function buildDashboardRunInput(serviceId: string): CreateRunInput | null {
  const template = dashboardRunTemplates[serviceId];
  const service = dashboardServices.find((item) => item.id === serviceId);

  if (!template || !service) {
    return null;
  }

  return {
    workspaceId: template.workspaceId,
    taskVersionId: template.taskVersionId,
    sessionVersionId: template.sessionVersionId,
    title: template.title,
    targetPath: `${template.targetRoot}-${buildRunSuffix()}/`,
    entrySurface: "dashboard",
    initialMessage: null,
    bindings: template.bindings,
  };
}
