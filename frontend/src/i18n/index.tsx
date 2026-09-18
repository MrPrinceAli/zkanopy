// Tiny i18n: two typed dictionaries, a provider, and t(key, vars). Language persists in localStorage
// and defaults to the browser language (Indonesian browsers get "id").
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { en } from "./en";
import { id } from "./id";

export type Lang = "en" | "id";
export type Key = keyof typeof en;
type Vars = Record<string, string | number>;

const DICTS: Record<Lang, Record<Key, string>> = { en, id };
const STORAGE = "zk-lang";

export function detectLang(): Lang {
  try {
    const s = localStorage.getItem(STORAGE);
    if (s === "en" || s === "id") return s;
  } catch {
    /* storage may be blocked */
  }
  return (navigator.language || "").toLowerCase().startsWith("id") ? "id" : "en";
}

export function translate(lang: Lang, key: Key, vars?: Vars): string {
  let s: string = DICTS[lang][key] ?? en[key] ?? key;
  if (vars) for (const [name, v] of Object.entries(vars)) s = s.split(`{${name}}`).join(String(v));
  return s;
}

interface Ctx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: Key, vars?: Vars) => string;
}

const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE, l);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const t = useCallback((key: Key, vars?: Vars) => translate(lang, key, vars), [lang]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): Ctx {
  const c = useContext(I18nContext);
  if (!c) throw new Error("useI18n must be used inside I18nProvider");
  return c;
}
