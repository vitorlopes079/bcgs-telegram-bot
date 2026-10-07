import en, { type Messages } from './en';
import th from './th';
import zh from './zh';

type LeafKeys<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${LeafKeys<T[K]>}`;
}[keyof T & string];

export type MessageKey = LeafKeys<typeof en>;

type Catalog = { [key: string]: string | Catalog };

/** Supported languages, in language-button order. Adding one means adding its catalog file and an entry here. */
const catalogs = { en, zh, th } satisfies Record<string, Messages>;

export type Locale = keyof typeof catalogs;

export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALES = Object.keys(catalogs) as Locale[];

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && Object.hasOwn(catalogs, value);
}

export function t(
  key: MessageKey,
  params: Record<string, string | number> = {},
  locale: Locale = DEFAULT_LOCALE,
): string {
  const read = (catalog: Catalog): string | undefined => {
    let value: string | Catalog = catalog;
    for (const part of key.split('.')) {
      if (typeof value === 'string' || !(part in value)) return undefined;
      value = value[part];
    }
    return typeof value === 'string' ? value : undefined;
  };

  const template = read(catalogs[locale]) ?? read(catalogs[DEFAULT_LOCALE]) ?? key;
  return template.replace(/\{([^{}]+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : placeholder,
  );
}

/** Maps a Telegram language_code such as "zh-hans" or "th" to a supported locale. */
export function localeFromLanguageCode(languageCode: string | undefined): Locale | null {
  const base = languageCode?.toLowerCase().split(/[-_]/)[0];
  return isLocale(base) ? base : null;
}

type KeywordKind = keyof Messages['complaint']['keywords'];

const keywordSets = new Map<KeywordKind, Set<string>>(
  (Object.keys(en.complaint.keywords) as KeywordKind[]).map((kind) => [
    kind,
    new Set(
      LOCALES.flatMap((locale) => catalogs[locale].complaint.keywords[kind].split(','))
        .map((word) => word.trim().toLowerCase())
        .filter(Boolean),
    ),
  ]),
);

/** True if `answer` (already trimmed and lowercased) is that keyword in any supported language. */
export function isKeyword(kind: KeywordKind, answer: string): boolean {
  return keywordSets.get(kind)?.has(answer) ?? false;
}

type LocaleSource = { locale?: Locale; from?: { language_code?: string } };

/** The locale resolved for this update by the locale middleware, or the Telegram language when it hasn't run. */
export function getLocale(ctx: LocaleSource): Locale {
  return ctx.locale ?? localeFromLanguageCode(ctx.from?.language_code) ?? DEFAULT_LOCALE;
}
