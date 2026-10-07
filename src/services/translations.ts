import { DEFAULT_LOCALE, type Locale } from '../i18n';

/** Locales to load for translated content: the user's, plus English as the fallback. */
export function contentLocales(locale: Locale): Locale[] {
  return locale === DEFAULT_LOCALE ? [locale] : [locale, DEFAULT_LOCALE];
}

/** The user's translation of a field, or the English one when it's missing or empty. */
export function pickTranslated<T extends { locale: string }, K extends keyof T>(
  rows: T[],
  field: K,
  locale: Locale,
): T[K] | undefined {
  const usable = (row: T) => {
    const value = row[field];
    return typeof value === 'string' ? value.trim() !== '' : value != null;
  };
  return (
    rows.find((row) => row.locale === locale && usable(row)) ??
    rows.find((row) => row.locale === DEFAULT_LOCALE && usable(row))
  )?.[field];
}
