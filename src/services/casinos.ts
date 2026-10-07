import { prisma } from '../prisma';
import { DEFAULT_LOCALE, type Locale } from '../i18n';
import { LOCALE } from '../site';
import {
  matchCasinos,
  prepareEntries,
  type CasinoMatch,
  type CasinoSearchEntry,
} from './casino-matching';
import { contentLocales, pickTranslated } from './translations';

export { domainToName, searchTerms, type CasinoMatch, type MatchType } from './casino-matching';

const MAX_RESULTS = 5;
const CACHE_TTL_MS = 5 * 60 * 1000;

/** name and licenses are in the user's language (English when missing); englishName is for admin messages. */
export type LocalizedCasinoMatch = CasinoMatch & { englishName: string };

export type LocalizedSearchResult = {
  matches: LocalizedCasinoMatch[];
  /** Closest casino names, only filled when there are no matches. In English, since that's what matching uses. */
  suggestions: string[];
};

type DisplayFields = { name: string; licenses: string[] };

type CacheEntry = {
  loadedAt: number;
  prepared: ReturnType<typeof prepareEntries>;
  display: Map<string, DisplayFields>;
};
const cache = new Map<Locale, CacheEntry>();
const pending = new Map<Locale, Promise<CacheEntry>>();

async function loadPublishedCasinos(locale: Locale): Promise<CacheEntry> {
  const locales = contentLocales(locale);
  const casinos = await prisma.casino.findMany({
    where: { status: 'published' },
    select: {
      id: true,
      slug: true,
      overallRating: true,
      translations: { where: { locale: { in: locales } }, select: { locale: true, name: true } },
      licenses: {
        select: {
          licenseNumber: true,
          license: {
            select: {
              translations: { where: { locale: { in: locales } }, select: { locale: true, name: true } },
            },
          },
        },
      },
    },
  });

  const display = new Map<string, DisplayFields>();
  // Matching always uses the English name and license names, so results don't depend on the user's language.
  const entries: CasinoSearchEntry[] = casinos.map((casino) => {
    const englishName = casino.translations.find((row) => row.locale === DEFAULT_LOCALE)?.name;
    display.set(casino.id, {
      name: pickTranslated(casino.translations, 'name', locale) ?? casino.slug,
      licenses: casino.licenses
        .map((l) => pickTranslated(l.license.translations, 'name', locale))
        .filter((name): name is string => Boolean(name)),
    });
    return {
      id: casino.id,
      slug: casino.slug,
      name: englishName ?? casino.slug,
      overallRating: casino.overallRating,
      licenses: casino.licenses
        .map((l) => l.license.translations.find((row) => row.locale === DEFAULT_LOCALE)?.name)
        .filter((name): name is string => Boolean(name)),
      licenseNumbers: casino.licenses
        .map((l) => l.licenseNumber)
        .filter((value): value is string => Boolean(value)),
    };
  });

  return { loadedAt: Date.now(), prepared: prepareEntries(entries), display };
}

async function getSearchIndex(locale: Locale): Promise<CacheEntry> {
  const cached = cache.get(locale);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached;

  let load = pending.get(locale);
  if (!load) {
    load = loadPublishedCasinos(locale)
      .then((entry) => {
        cache.set(locale, entry);
        return entry;
      })
      .finally(() => pending.delete(locale));
    pending.set(locale, load);
  }

  return load;
}

function localize(match: CasinoMatch, index: CacheEntry): LocalizedCasinoMatch {
  const display = index.display.get(match.id);
  return {
    ...match,
    englishName: match.name,
    name: display?.name ?? match.name,
    licenses: display?.licenses ?? match.licenses,
  };
}

/** Matches plus "did you mean" names (only filled when nothing matched). */
export async function searchCasinos(
  query: string,
  limit = MAX_RESULTS,
  locale: Locale = LOCALE,
): Promise<LocalizedSearchResult> {
  const index = await getSearchIndex(locale);
  const { matches, suggestions } = matchCasinos(index.prepared, query, limit);
  return { matches: matches.map((match) => localize(match, index)), suggestions };
}

/** A published casino by slug (for inline buttons), or null if it's unpublished or gone. */
export async function getCasinoBySlug(slug: string, locale: Locale = LOCALE): Promise<LocalizedCasinoMatch | null> {
  const index = await getSearchIndex(locale);
  const found = index.prepared.find((item) => item.entry.slug === slug)?.entry;
  if (!found) return null;
  const { licenseNumbers: _licenseNumbers, ...entry } = found;
  return localize({ ...entry, matchType: 'exact' }, index);
}

export async function findCasinos(
  query: string,
  limit = MAX_RESULTS,
  locale: Locale = LOCALE,
): Promise<LocalizedCasinoMatch[]> {
  return (await searchCasinos(query, limit, locale)).matches;
}
