import type { BillingSource } from "@lingban/contracts";
import { l, type LocalizedString } from "./i18n";

export function formatBillingUsd(value: number) {
  if (value >= 100) {
    return `$${value.toFixed(2)}`;
  }

  if (value >= 1) {
    return `$${value.toFixed(3)}`;
  }

  return `$${value.toFixed(4)}`;
}

export function formatBillingQuantity(value: number) {
  return Number.isInteger(value)
    ? value.toLocaleString("en-US")
    : value.toLocaleString("en-US", {
        maximumFractionDigits: 4,
      });
}

export function billingSourceLabel(source: BillingSource): LocalizedString {
  switch (source) {
    case "run-message":
      return l("对话消息", "Run message");
    case "run-upload":
      return l("上传材料", "Run upload");
    case "file-read":
      return l("读取文件", "File read");
    case "file-preview":
      return l("预览文件", "File preview");
    case "download-ticket":
      return l("下载票据", "Download ticket");
    case "file-download":
      return l("直接下载", "Direct download");
    case "mcp-call":
      return l("MCP 调用", "MCP call");
    case "audit-export":
      return l("审计导出", "Audit export");
    case "runtime-estimate":
    default:
      return l("运行时长", "Runtime estimate");
  }
}

export function billingSourceTone(source: BillingSource): "" | "active" | "warn" | "success" {
  switch (source) {
    case "mcp-call":
      return "active";
    case "runtime-estimate":
      return "success";
    case "audit-export":
    case "download-ticket":
      return "warn";
    case "file-download":
    case "file-preview":
    case "file-read":
      return "";
    case "run-message":
    case "run-upload":
    default:
      return "active";
  }
}
