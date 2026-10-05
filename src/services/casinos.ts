import { prisma } from '../prisma';
import type { Locale } from '../i18n';
import { LOCALE } from '../site';

const MAX_RESULTS = 5;

// Postgres ILIKE is accent-sensitive, so unaccented spellings of stored names need explicit variants.
const ACCENT_VARIANTS: Record<string, string> = {
  curacao: 'curaçao',
};

export type CasinoMatch = {
  id: string;
  slug: string;
  name: string;
  overallRating: number | null;
  licenses: string[];
};

export function domainToName(query: string): string | null {
  const match = query.match(/^(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+)(?:\.[a-z0-9-]+)+\/?$/i);
  return match ? match[1] : null;
}

export function searchTerms(query: string): string[] {
  const terms = new Set([query]);

  const domainName = domainToName(query);
  if (domainName) terms.add(domainName);

  for (const term of [...terms]) {
    const lower = term.toLowerCase();
    for (const [plain, accented] of Object.entries(ACCENT_VARIANTS)) {
      if (lower.includes(plain)) terms.add(lower.replaceAll(plain, accented));
    }
  }

  return [...terms];
}

export async function findCasinos(
  query: string,
  limit = MAX_RESULTS,
  locale: Locale = LOCALE,
): Promise<CasinoMatch[]> {
  const conditions = searchTerms(query).flatMap((term) => {
    const contains = { contains: term, mode: 'insensitive' as const };
    return [
      { slug: contains },
      { translations: { some: { locale, name: contains } } },
      { licenses: { some: { licenseNumber: contains } } },
      {
        licenses: {
          some: { license: { translations: { some: { locale, name: contains } } } },
        },
      },
    ];
  });

  const casinos = await prisma.casino.findMany({
    where: {
      status: 'published',
      OR: conditions,
    },
    select: {
      id: true,
      slug: true,
      overallRating: true,
      translations: { where: { locale }, select: { name: true } },
      licenses: {
        select: {
          license: {
            select: { translations: { where: { locale }, select: { name: true } } },
          },
        },
      },
    },
    orderBy: { overallRating: { sort: 'desc', nulls: 'last' } },
    take: limit,
  });

  return casinos.map((casino) => ({
    id: casino.id,
    slug: casino.slug,
    name: casino.translations[0]?.name ?? casino.slug,
    overallRating: casino.overallRating,
    licenses: casino.licenses
      .map((l) => l.license.translations[0]?.name)
      .filter((name): name is string => Boolean(name)),
  }));
}
