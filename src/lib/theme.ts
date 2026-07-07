import { lingbanThemeVars } from "@lingban/ui-tokens";

export type DashboardThemeMode = keyof typeof lingbanThemeVars.dashboard;

export function applyDashboardTheme(theme: DashboardThemeMode) {
  if (typeof document === "undefined") {
    return;
  }

  const vars = lingbanThemeVars.dashboard[theme] as Record<string, string>;
  for (const [token, value] of Object.entries(vars)) {
    document.body.style.setProperty(`--${token}`, value);
  }
}
