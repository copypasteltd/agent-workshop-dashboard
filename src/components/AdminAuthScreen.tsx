import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { dashboardAssets } from "../data/dashboardData";
import { dashboardAuthApi } from "../lib/api";
import { t } from "../lib/i18n";
import { useDashboardUiStore } from "../stores/dashboardUiStore";
import { useDashboardAuthStore } from "../stores/dashboardAuthStore";

type AuthFormState = {
  email: string;
  password: string;
};

const initialFormState: AuthFormState = {
  email: "",
  password: "",
};

export function AdminAuthScreen() {
  const lang = useDashboardUiStore((state) => state.lang);
  const bootstrapError = useDashboardAuthStore((state) => state.lastError);
  const applySessionResponse = useDashboardAuthStore((state) => state.applySessionResponse);
  const queryClient = useQueryClient();
  const [form, setForm] = useState<AuthFormState>(initialFormState);

  const authMutation = useMutation({
    mutationFn: async () => {
      const response = await dashboardAuthApi.login({
        email: form.email.trim(),
        password: form.password,
      });

      if (!response.platformAccess.isPlatformAdmin) {
        throw new Error(
          t(lang, {
            zh: "当前账号不具备平台管理员权限，请改用工作区控制台入口。",
            en: "This account does not have platform admin access. Use the workspace console instead.",
          })
        );
      }

      return response;
    },
    onSuccess: async (response) => {
      applySessionResponse(response);
      await queryClient.removeQueries({
        queryKey: ["dashboard"],
      });
    },
  });

  const disabled = useMemo(
    () => !form.email.trim() || !form.password,
    [form.email, form.password]
  );

  const errorText =
    authMutation.error instanceof Error ? authMutation.error.message : bootstrapError;

  return (
    <div className="auth-shell">
      <div className="auth-panel">
        <div className="auth-brand">
          <div className="logo auth-logo">
            <img src={dashboardAssets.logo} alt="Lingban Ciyuan logo" />
          </div>
          <div>
            <div className="eyebrow">
              {t(lang, { zh: "平台管理入口", en: "Platform admin sign in" })}
            </div>
            <h1 className="auth-title">
              {t(lang, {
                zh: "灵办词元 Admin Console",
                en: "Lingban Ciyuan Admin Console",
              })}
            </h1>
            <p className="auth-copy">
              {t(lang, {
                zh: "该入口只用于平台级管理，包括 Provider 总目录、上游路由治理和控制面运维。",
                en: "This surface is reserved for platform operations such as provider catalog management, upstream routing policy, and control-plane operations.",
              })}
            </p>
          </div>
        </div>

        <div className="auth-form">
          <label className="auth-field">
            <span className="auth-label">{t(lang, { zh: "邮箱", en: "Email" })}</span>
            <input
              className="auth-input"
              type="email"
              value={form.email}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  email: event.target.value,
                }))
              }
              placeholder="name@example.com"
            />
          </label>

          <label className="auth-field">
            <span className="auth-label">{t(lang, { zh: "密码", en: "Password" })}</span>
            <input
              className="auth-input"
              type="password"
              value={form.password}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  password: event.target.value,
                }))
              }
              placeholder={t(lang, {
                zh: "输入平台管理员密码",
                en: "Enter the platform admin password",
              })}
            />
          </label>

          {errorText ? <div className="auth-error">{errorText}</div> : null}

          <button
            className="auth-submit"
            type="button"
            disabled={disabled || authMutation.isPending}
            onClick={() => authMutation.mutate()}
          >
            {authMutation.isPending
              ? t(lang, { zh: "处理中", en: "Submitting" })
              : t(lang, { zh: "进入 Admin Console", en: "Enter admin console" })}
          </button>
        </div>

        <div className="auth-highlights">
          {[
            {
              title: { zh: "独立入口", en: "Independent entry" },
              note: {
                zh: "平台管理员与工作区操作者分离，避免把租户侧操作与平台侧配置混在同一导航里。",
                en: "Platform operators stay separate from workspace operators so tenant actions and platform controls do not share the same navigation.",
              },
            },
            {
              title: { zh: "平台目录", en: "Platform catalog" },
              note: {
                zh: "这里维护可复用的上游 Provider 档案，不承载工作区会话与任务对话。",
                en: "Reusable upstream provider profiles are managed here without mixing workspace conversations or task operations.",
              },
            },
            {
              title: { zh: "权限收口", en: "Privilege boundary" },
              note: {
                zh: "非平台管理员不会进入该入口的正式交互流。",
                en: "Non-platform administrators do not enter the formal interaction flow of this surface.",
              },
            },
          ].map((item) => (
            <div className="auth-highlight" key={t(lang, item.title)}>
              <div className="file-name">{t(lang, item.title)}</div>
              <div className="file-meta">{t(lang, item.note)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
