import { prisma } from '../prisma';
import { DEFAULT_LOCALE, type Locale } from '../i18n';
import { LOCALE } from '../site';
import { contentLocales, pickTranslated } from './translations';

const MAX_RESULTS = 10;

/** name is in the requested language, falling back to English and then the slug. */
export type RankedCasino = {
  slug: string;
  overallRating: number | null;
  name: string;
};

export type RankingCategory = {
  id: string;
  slug: string;
  name: string;
};

type TranslatedRow = { slug: string; translations: { locale: string; name: string }[] };

function translatedName(row: TranslatedRow, locale: Locale): string {
  return pickTranslated(row.translations, 'name', locale) ?? row.slug;
}

function casinoSelect(locale: Locale) {
  return {
    slug: true,
    overallRating: true,
    translations: { where: { locale: { in: contentLocales(locale) } }, select: { locale: true, name: true } },
  } as const;
}

export async function getTopCasinos(locale: Locale = LOCALE): Promise<RankedCasino[]> {
  const casinos = await prisma.casino.findMany({
    where: { status: 'published' },
    select: casinoSelect(locale),
    orderBy: [{ overallRating: { sort: 'desc', nulls: 'last' } }, { slug: 'asc' }],
    take: MAX_RESULTS,
  });

  return casinos.map((casino) => ({
    slug: casino.slug,
    overallRating: casino.overallRating,
    name: translatedName(casino, locale),
  }));
}

export async function findCategory(input: string, locale: Locale = LOCALE): Promise<RankingCategory | null> {
  const match = { equals: input, mode: 'insensitive' as const };

  // Matched on the slug or English name only, as before; the user's language only affects the displayed name.
  const category = await prisma.category.findFirst({
    where: {
      status: 'published',
      OR: [{ slug: match }, { translations: { some: { locale: DEFAULT_LOCALE, name: match } } }],
    },
    select: {
      id: true,
      slug: true,
      translations: { where: { locale: { in: contentLocales(locale) } }, select: { locale: true, name: true } },
    },
  });

  return category && { id: category.id, slug: category.slug, name: translatedName(category, locale) };
}

export async function getTopCasinosInCategory(
  categoryId: string,
  locale: Locale = LOCALE,
): Promise<RankedCasino[]> {
  const rows = await prisma.casinoCategory.findMany({
    where: { categoryId, casino: { status: 'published' } },
    select: { casino: { select: casinoSelect(locale) } },
    orderBy: [
      { rank: { sort: 'asc', nulls: 'last' } },
      { casino: { overallRating: { sort: 'desc', nulls: 'last' } } },
      { casino: { slug: 'asc' } },
    ],
    take: MAX_RESULTS,
  });

  return rows.map(({ casino }) => ({
    slug: casino.slug,
    overallRating: casino.overallRating,
    name: translatedName(casino, locale),
  }));
}
