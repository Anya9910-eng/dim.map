import { createContext, useContext, useState } from "react";
import React from "react";

export type Lang = "en" | "ru";

const LS_KEY = "draftfly-lang";

export const t = {
  en: {
    overview: "Overview",
    clients: "Clients",
    personas: "Personas",
    campaigns: "Campaigns",
    draftReplies: "Draft Replies",
    replyHistory: "Reply History",
    internal: "Internal",
    testFlow: "Test Flow",
    clientOnboarding: "Client Onboarding",
    internalSetup: "Internal Setup",
    settings: "Settings",
    signOut: "Sign out",
    signingOut: "Signing out…",
    theme: "Theme",
    language: "Language",
  },
  ru: {
    overview: "Обзор",
    clients: "Клиенты",
    personas: "Персоны",
    campaigns: "Кампании",
    draftReplies: "Черновики",
    replyHistory: "История",
    internal: "Внутреннее",
    testFlow: "Тест потока",
    clientOnboarding: "Онбординг",
    internalSetup: "Настройка",
    settings: "Настройки",
    signOut: "Выйти",
    signingOut: "Выходим…",
    theme: "Тема",
    language: "Язык",
  },
} as const;

interface LangContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  tr: typeof t.en;
}

const LangContext = createContext<LangContextValue>({
  lang: "en",
  setLang: () => {},
  tr: t.en,
});

export function LangProvider({ children }: { children: React.ReactNode }) {
  // The dashboard is English-only: the RU switcher is gone from the sidebar.
  // A previously saved "ru" is therefore discarded rather than honoured —
  // restoring it would leave that person in Russian with no control to leave.
  // The `ru` strings below stay put, so putting the switcher back is a UI
  // change and nothing more.
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      localStorage.removeItem(LS_KEY);
    } catch {}
    return "en";
  });

  function setLang(l: Lang) {
    setLangState(l);
    try { localStorage.setItem(LS_KEY, l); } catch {}
  }

  return (
    <LangContext.Provider value={{ lang, setLang, tr: t[lang] as typeof t.en }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang() {
  return useContext(LangContext);
}
