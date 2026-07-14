import i18n from "i18next";
import { initReactI18next } from "react-i18next";

export type Lang = "zh" | "en";

export type LocalizedString = {
  zh: string;
  en: string;
};

const resources = {
  zh: {
    translation: {
      "dashboard.title": "灵办词元 Workspace Console",
      "dashboard.operatorTitle": "灵办词元 / Workspace Console",
    },
  },
  en: {
    translation: {
      "dashboard.title": "Lingban Ciyuan Workspace Console",
      "dashboard.operatorTitle": "Lingban Ciyuan / Workspace Console",
    },
  },
} as const;

if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    resources,
    lng: "zh",
    fallbackLng: "zh",
    supportedLngs: ["zh", "en"],
    interpolation: {
      escapeValue: false,
    },
    returnNull: false,
  });
}

export const dashboardI18n = i18n;

export const l = (zh: string, en: string): LocalizedString => ({ zh, en });

export const t = (lang: Lang, value: LocalizedString | string): string =>
  typeof value === "string" ? dashboardI18n.t(value) : value[lang];

export function setDashboardLanguage(lang: Lang) {
  void dashboardI18n.changeLanguage(lang);
}
