import type { ReactNode } from "react";
import { dashboardAssets } from "../data/dashboardData";

type AdminAccessDeniedScreenProps = {
  title: ReactNode;
  detail: ReactNode;
  actions: ReactNode;
};

export function AdminAccessDeniedScreen(input: AdminAccessDeniedScreenProps) {
  return (
    <div className="auth-shell">
      <div className="auth-panel auth-panel-compact">
        <div className="auth-brand">
          <div className="logo auth-logo">
            <img src={dashboardAssets.logo} alt="Lingban Ciyuan logo" />
          </div>
          <div>
            <div className="eyebrow">Admin Console</div>
            <h1 className="auth-title">{input.title}</h1>
            <p className="auth-copy">{input.detail}</p>
          </div>
        </div>
        <div className="pill-row">{input.actions}</div>
      </div>
    </div>
  );
}
