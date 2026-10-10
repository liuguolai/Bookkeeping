import { useSyncExternalStore } from 'react';
import english from './locales/en.json';
import traditional from './locales/zh-TW.json';

export const locales = ['zh-CN', 'zh-TW', 'en'] as const;
export type Locale = (typeof locales)[number];
export const languageNames: Record<Locale, string> = {
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  en: 'English',
};
export const LANGUAGE_KEY = 'pocket-ledger-language';
const catalogs: Record<Locale, Record<string, string>> = {
  'zh-CN': {},
  'zh-TW': traditional,
  en: english,
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && locales.includes(value as Locale);
}

export function detectLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    if (/^zh(?:-|$)/i.test(language)) {
      return /(?:hant|tw|hk|mo)(?:-|$)/i.test(language) ? 'zh-TW' : 'zh-CN';
    }
    if (/^en(?:-|$)/i.test(language)) return 'en';
  }
  return 'zh-CN';
}

function initialLocale(): Locale {
  // Unit tests and non-browser callers use the original source language.
  if (typeof window === 'undefined') return 'zh-CN';
  try {
    const saved = window.localStorage.getItem(LANGUAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    // Storage restrictions must not prevent opening the ledger.
  }
  return detectLocale(window.navigator.languages ?? [window.navigator.language]);
}

let locale = initialLocale();
const listeners = new Set<() => void>();
export const getLocale = (): Locale => locale;
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale, getLocale);
}

/** Source-language keys keep the original copy visible at each call site.
 * Only application messages belong here; never pass user names or notes.
 * Values are replaced in one pass so user text containing {0} stays literal.
 */
export function translate(key: string, language: Locale, values: readonly unknown[] = []): string {
  const message = Object.hasOwn(catalogs[language], key) ? catalogs[language][key] : key;
  return message.replace(/\{(\d+)\}/g, (token, index: string) =>
    Number(index) < values.length ? String(values[Number(index)]) : token,
  );
}
export function t(key: string, values: readonly unknown[] = []): string {
  return translate(key, locale, values);
}

/** Status/error messages can outlive a language switch. Translate known messages only. */
export function messageText(message: string): string {
  for (const catalog of [english, traditional]) {
    const source = Object.keys(catalog).find(
      (key) => catalog[key as keyof typeof catalog] === message,
    );
    if (source) return t(source);
  }
  return t(message);
}

function updateDocument() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
  document.title = t('口袋账本');
}
export function setLocale(next: Locale) {
  if (!isLocale(next)) return;
  try {
    window.localStorage.setItem(LANGUAGE_KEY, next);
  } catch {
    /* Use for this session. */
  }
  locale = next;
  updateDocument();
  listeners.forEach((listener) => listener());
}
if (typeof window !== 'undefined') {
  updateDocument();
  window.addEventListener('storage', (event) => {
    if (event.key !== LANGUAGE_KEY && event.key !== null) return;
    locale = initialLocale();
    updateDocument();
    listeners.forEach((listener) => listener());
  });
}

export function monthText(value: string): string {
  const [year, month] = value.split('-').map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, 1);
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(date);
}
export function monthName(month: number): string {
  return new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2000, month - 1, 1)),
  );
}
