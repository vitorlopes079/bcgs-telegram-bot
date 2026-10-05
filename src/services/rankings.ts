import { prisma } from '../prisma';
import type { Locale } from '../i18n';
import { LOCALE } from '../site';

const MAX_RESULTS = 10;

export type RankedCasino = {
  slug: string;
  overallRating: number | null;
  translations: { name: string }[];
};

export type RankingCategory = {
  id: string;
  slug: string;
  translations: { name: string }[];
};

function casinoSelect(locale: Locale) {
  return {
    slug: true,
    overallRating: true,
    translations: { where: { locale }, select: { name: true } },
  } as const;
}

export async function getTopCasinos(locale: Locale = LOCALE): Promise<RankedCasino[]> {
  return prisma.casino.findMany({
    where: { status: 'published' },
    select: casinoSelect(locale),
    orderBy: [{ overallRating: { sort: 'desc', nulls: 'last' } }, { slug: 'asc' }],
    take: MAX_RESULTS,
  });
}

export async function findCategory(input: string, locale: Locale = LOCALE): Promise<RankingCategory | null> {
  const match = { equals: input, mode: 'insensitive' as const };

  return prisma.category.findFirst({
    where: {
      status: 'published',
      OR: [{ slug: match }, { translations: { some: { locale, name: match } } }],
    },
    select: {
      id: true,
      slug: true,
      translations: { where: { locale }, select: { name: true } },
    },
  });
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

  return rows.map((row) => row.casino);
}
