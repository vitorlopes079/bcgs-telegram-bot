import { prisma } from '../prisma';
import type { Locale } from '../i18n';
import { LOCALE } from '../site';
import {
  matchCasinos,
  prepareEntries,
  type CasinoMatch,
  type CasinoSearchEntry,
  type CasinoSearchResult,
} from './casino-matching';

export { domainToName, searchTerms, type CasinoMatch, type MatchType } from './casino-matching';

const MAX_RESULTS = 5;
const CACHE_TTL_MS = 5 * 60 * 1000;

type CacheEntry = { loadedAt: number; prepared: ReturnType<typeof prepareEntries> };
const cache = new Map<Locale, CacheEntry>();
const pending = new Map<Locale, Promise<CacheEntry>>();

async function loadPublishedCasinos(locale: Locale): Promise<CasinoSearchEntry[]> {
  const casinos = await prisma.casino.findMany({
    where: { status: 'published' },
    select: {
      id: true,
      slug: true,
      overallRating: true,
      translations: { where: { locale }, select: { name: true } },
      licenses: {
        select: {
          licenseNumber: true,
          license: {
            select: { translations: { where: { locale }, select: { name: true } } },
          },
        },
      },
    },
  });

  return casinos.map((casino) => ({
    id: casino.id,
    slug: casino.slug,
    name: casino.translations[0]?.name ?? casino.slug,
    overallRating: casino.overallRating,
    licenses: casino.licenses
      .map((l) => l.license.translations[0]?.name)
      .filter((name): name is string => Boolean(name)),
    licenseNumbers: casino.licenses
      .map((l) => l.licenseNumber)
      .filter((value): value is string => Boolean(value)),
  }));
}

async function getSearchIndex(locale: Locale) {
  const cached = cache.get(locale);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached.prepared;

  let load = pending.get(locale);
  if (!load) {
    load = loadPublishedCasinos(locale)
      .then((entries) => {
        const entry = { loadedAt: Date.now(), prepared: prepareEntries(entries) };
        cache.set(locale, entry);
        return entry;
      })
      .finally(() => pending.delete(locale));
    pending.set(locale, load);
  }

  return (await load).prepared;
}

/** Matches plus "did you mean" names (only filled when nothing matched). */
export async function searchCasinos(
  query: string,
  limit = MAX_RESULTS,
  locale: Locale = LOCALE,
): Promise<CasinoSearchResult> {
  return matchCasinos(await getSearchIndex(locale), query, limit);
}

export async function findCasinos(
  query: string,
  limit = MAX_RESULTS,
  locale: Locale = LOCALE,
): Promise<CasinoMatch[]> {
  return (await searchCasinos(query, limit, locale)).matches;
}
