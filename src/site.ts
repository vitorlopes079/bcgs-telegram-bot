import { t, type Locale } from './i18n';

export const SITE_URL = 'https://www.bc.gs';
export const LOCALE = 'en';

export function casinoUrl(slug: string, locale: Locale = LOCALE): string {
  return `${SITE_URL}/${locale}/casinos/${slug}`;
}

export function formatRating(rating: number | null, locale: Locale = LOCALE): string {
  return rating != null
    ? `${locale === 'en' ? rating.toFixed(1) : new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(rating)}/5`
    : t('common.notRated', {}, locale);
}
