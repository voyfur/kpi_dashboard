import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { messages, type Messages } from './messages';
import type { Locale } from '../domain/types';

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  messages: Messages;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>('en');
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const value = useMemo(() => ({ locale, setLocale, messages: messages[locale] }), [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const value = useContext(LocaleContext);
  if (!value) throw new Error('useLocale must be used within LocaleProvider');
  return value;
}
