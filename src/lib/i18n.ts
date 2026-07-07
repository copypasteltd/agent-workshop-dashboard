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
      "dashboard.title": "灵办词元 Dashboard",
      "dashboard.operatorTitle": "灵办词元 / Operator Dashboard",
    },
  },
  en: {
    translation: {
      "dashboard.title": "Lingban Ciyuan Dashboard",
      "dashboard.operatorTitle": "Lingban Ciyuan / Operator Dashboard",
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
