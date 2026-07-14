import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { dashboardAssets } from "../data/dashboardData";
import { dashboardAuthApi } from "../lib/api";
import { t } from "../lib/i18n";
import { useDashboardUiStore } from "../stores/dashboardUiStore";
import { useDashboardAuthStore } from "../stores/dashboardAuthStore";

type AuthMode = "login" | "register";

type AuthFormState = {
  displayName: string;
  workspaceName: string;
  email: string;
  password: string;
};

const initialFormState: AuthFormState = {
  displayName: "",
  workspaceName: "",
  email: "",
  password: "",
};

export function DashboardAuthScreen() {
  const lang = useDashboardUiStore((state) => state.lang);
  const setCurrentWorkspaceId = useDashboardUiStore(
    (state) => state.setCurrentWorkspaceId
  );
  const bootstrapError = useDashboardAuthStore((state) => state.lastError);
  const applySessionResponse = useDashboardAuthStore(
    (state) => state.applySessionResponse
  );
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<AuthMode>("login");
  const [form, setForm] = useState<AuthFormState>(initialFormState);

  const authMutation = useMutation({
    mutationFn: async () => {
      if (mode === "register") {
        return dashboardAuthApi.register({
          email: form.email.trim(),
          password: form.password,
          displayName: form.displayName.trim(),
          workspaceName: form.workspaceName.trim() || undefined,
        });
      }

      return dashboardAuthApi.login({
        email: form.email.trim(),
        password: form.password,
      });
    },
    onSuccess: async (response) => {
      applySessionResponse(response);
      setCurrentWorkspaceId(response.currentWorkspace.workspaceId);
      await queryClient.removeQueries({
        queryKey: ["dashboard"],
      });
    },
  });

  const disabled = useMemo(() => {
    if (!form.email.trim() || !form.password) {
      return true;
    }

    if (mode === "register") {
      return form.displayName.trim().length === 0 || form.password.length < 12;
    }

    return false;
  }, [form.displayName, form.email, form.password, mode]);

  const errorText =
    authMutation.error instanceof Error
      ? authMutation.error.message
      : bootstrapError;

  return (
    <div className="auth-shell">
      <div className="auth-panel">
        <div className="auth-brand">
          <div className="logo auth-logo">
            <img src={dashboardAssets.logo} alt="灵办词元 logo" />
          </div>
          <div>
            <div className="eyebrow">
              {t(lang, { zh: "工作台登录", en: "Workspace sign in" })}
            </div>
            <h1 className="auth-title">
              {t(lang, {
                zh: "灵办词元 Workspace Console",
                en: "Lingban Ciyuan Workspace Console",
              })}
            </h1>
            <p className="auth-copy">
              {t(lang, {
                zh: "登录后进入与你的工作区绑定的工坊、实例与 Creator 包。实例继续沿用完整对话模式，文件与结果严格绑定当前空间。",
                en: "Sign in to enter the workshops, instances, settings, and creator packages bound to your workspace. Live runs stay in full conversation mode and files remain scoped to the active space.",
              })}
            </p>
          </div>
        </div>

        <div className="auth-toggle">
          <button
            className={`auth-toggle-btn ${mode === "login" ? "active" : ""}`}
            type="button"
            onClick={() => setMode("login")}
          >
            {t(lang, { zh: "登录", en: "Sign in" })}
          </button>
          <button
            className={`auth-toggle-btn ${mode === "register" ? "active" : ""}`}
            type="button"
            onClick={() => setMode("register")}
          >
            {t(lang, { zh: "注册", en: "Create account" })}
          </button>
        </div>

        <div className="auth-form">
          {mode === "register" ? (
            <>
              <label className="auth-field">
                <span className="auth-label">
                  {t(lang, { zh: "显示名称", en: "Display name" })}
                </span>
                <input
                  className="auth-input"
                  type="text"
                  value={form.displayName}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      displayName: event.target.value,
                    }))
                  }
                  placeholder={t(lang, {
                    zh: "例如：内容运营组 / 张宁",
                    en: "For example: Content Ops / Alex",
                  })}
                />
              </label>
              <label className="auth-field">
                <span className="auth-label">
                  {t(lang, {
                    zh: "个人工作区名称",
                    en: "Personal workspace name",
                  })}
                </span>
                <input
                  className="auth-input"
                  type="text"
                  value={form.workspaceName}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      workspaceName: event.target.value,
                    }))
                  }
                  placeholder={t(lang, {
                    zh: "留空则自动生成",
                    en: "Leave empty to auto-generate",
                  })}
                />
              </label>
            </>
          ) : null}

          <label className="auth-field">
            <span className="auth-label">
              {t(lang, { zh: "邮箱", en: "Email" })}
            </span>
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
            <span className="auth-label">
              {t(lang, { zh: "密码", en: "Password" })}
            </span>
            <input
              className="auth-input"
              type="password"
              value={form.password}
              minLength={mode === "register" ? 12 : 1}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  password: event.target.value,
                }))
              }
              placeholder={t(lang, {
                zh: "注册时至少 12 位",
                en: "At least 12 characters for registration",
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
              : mode === "register"
                ? t(lang, { zh: "创建并进入工作区", en: "Create workspace and continue" })
                : t(lang, { zh: "进入工作台", en: "Enter workspace" })}
          </button>
        </div>

        <div className="auth-highlights">
          {[
            {
              title: { zh: "实例隔离", en: "Isolated runtime" },
              note: {
                zh: "每个用户实例进入独立运行环境，关闭后销毁。",
                en: "Each user run enters its own runtime and is destroyed on close.",
              },
            },
            {
              title: { zh: "完整对话", en: "Full conversation" },
              note: {
                zh: "运行中可以持续对话、补资料、追问结果。",
                en: "You can keep talking, add materials, and ask about results during a run.",
              },
            },
            {
              title: { zh: "工作区边界", en: "Workspace boundary" },
              note: {
                zh: "文件浏览、下载与结果目录全部受当前空间约束。",
                en: "File browsing, downloads, and result paths stay inside the active workspace boundary.",
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
