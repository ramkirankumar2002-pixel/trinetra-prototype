"use client";

import type { Language } from "@trinetra/shared";
import { createContext, useCallback, useContext, useEffect, type ReactNode } from "react";
import { useLanguageStore, type LanguageScope } from "./language-store";
import { translate, type Translate } from "./translate";

const ScopeContext = createContext<LanguageScope>("staff");

/** Says whose language the pages inside use. Without it, the staff language. */
export function LanguageScopeProvider({
  scope,
  children,
}: {
  scope: LanguageScope;
  children: ReactNode;
}) {
  return <ScopeContext.Provider value={scope}>{children}</ScopeContext.Provider>;
}

export function useLanguage() {
  const scope = useContext(ScopeContext);
  const language = useLanguageStore((state) => state[scope]);
  const set = useLanguageStore((state) => state.setLanguage);
  const setLanguage = useCallback((next: Language) => set(scope, next), [set, scope]);

  useEffect(() => {
    void useLanguageStore.persist.rehydrate();
  }, []);
  // So the browser picks the right letters and a screen reader the right voice.
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  return { language, setLanguage };
}

/** const t = useT(); t("shell.loggedInAs", { name }) */
export function useT(): Translate {
  const { language } = useLanguage();
  return useCallback((key, params) => translate(language, key, params), [language]);
}
