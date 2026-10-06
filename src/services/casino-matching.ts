// Pure matching logic for casino search. No database access, so it can be tested with stubbed data.

// NFD folding already strips most accents; this map keeps explicit variants for spellings it misses.
const ACCENT_VARIANTS: Record<string, string> = {
  curacao: 'curaçao',
};

const SUGGESTION_LIMIT = 3;

export type MatchType = 'exact' | 'prefix' | 'contains' | 'fuzzy';

export type CasinoSearchEntry = {
  id: string;
  slug: string;
  name: string;
  overallRating: number | null;
  licenses: string[];
  licenseNumbers: string[];
};

export type CasinoMatch = Omit<CasinoSearchEntry, 'licenseNumbers'> & { matchType: MatchType };

export type CasinoSearchResult = {
  matches: CasinoMatch[];
  /** Closest casino names, only filled when there are no matches. */
  suggestions: string[];
};

type PreparedEntry = {
  entry: CasinoSearchEntry;
  /** Normalized name, slug, and the name without a domain suffix (e.g. "Stake.com" -> "stake"). */
  primaryKeys: string[];
  /** Normalized license names and numbers; these never count as an exact casino match. */
  licenseKeys: string[];
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

/** Lowercase, strip accents, and drop spaces, hyphens, dots and underscores. */
export function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s\-._]+/g, '');
}

function normalizedTerms(query: string): string[] {
  return [...new Set(searchTerms(query.trim()).map(normalize))].filter(Boolean);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function prepareEntries(entries: CasinoSearchEntry[]): PreparedEntry[] {
  return entries.map((entry) => {
    const nameDomain = domainToName(entry.name);
    return {
      entry,
      primaryKeys: unique([
        normalize(entry.name),
        normalize(entry.slug),
        nameDomain ? normalize(nameDomain) : '',
      ]),
      licenseKeys: unique([...entry.licenses, ...entry.licenseNumbers].map(normalize)),
    };
  });
}

const TIER: Record<MatchType, number> = { exact: 0, prefix: 1, contains: 2, fuzzy: 3 };

function directMatch(prepared: PreparedEntry, terms: string[]): MatchType | null {
  let best: MatchType | null = null;
  const consider = (type: MatchType) => {
    if (!best || TIER[type] < TIER[best]) best = type;
  };

  for (const term of terms) {
    for (const key of prepared.primaryKeys) {
      if (key === term) consider('exact');
      else if (key.startsWith(term)) consider('prefix');
      else if (key.includes(term)) consider('contains');
      // "stake casino" should still find Stake; short keys are skipped to avoid noise.
      else if (key.length >= 4 && term.includes(key)) consider('contains');
    }
    if (prepared.licenseKeys.some((key) => key.includes(term))) consider('contains');
  }

  return best;
}

/** Optimal string alignment distance: Levenshtein plus adjacent transpositions ("stkae" -> "stake" is 1). */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }

  return d[a.length][b.length];
}

/** Typos allowed for a confident fuzzy match: none under 3 characters, 1 up to 6, then 2. */
export function allowedTypos(length: number): number {
  if (length < 3) return 0;
  return length <= 6 ? 1 : 2;
}

function suggestionDistanceLimit(length: number): number {
  if (length < 3) return 0;
  return Math.max(allowedTypos(length) + 1, Math.ceil(length * 0.4));
}

type Closeness = { distance: number; fuzzy: boolean; suggest: boolean };

function closeness(prepared: PreparedEntry, terms: string[]): Closeness {
  const result: Closeness = { distance: Number.POSITIVE_INFINITY, fuzzy: false, suggest: false };
  for (const term of terms) {
    let distance = Number.POSITIVE_INFINITY;
    for (const key of prepared.primaryKeys) {
      distance = Math.min(distance, editDistance(term, key));
      // Also compare against the start of longer names, so "stkae" is close to "stakecasino".
      if (term.length >= 4 && key.length > term.length) {
        distance = Math.min(distance, editDistance(term, key.slice(0, term.length)));
      }
    }
    result.distance = Math.min(result.distance, distance);
    if (distance <= allowedTypos(term.length)) result.fuzzy = true;
    if (distance <= suggestionDistanceLimit(term.length)) result.suggest = true;
  }
  return result;
}

function byRating(a: CasinoSearchEntry, b: CasinoSearchEntry): number {
  const ratingA = a.overallRating ?? Number.NEGATIVE_INFINITY;
  const ratingB = b.overallRating ?? Number.NEGATIVE_INFINITY;
  return ratingB - ratingA || a.name.localeCompare(b.name);
}

function toMatch(entry: CasinoSearchEntry, matchType: MatchType): CasinoMatch {
  const { licenseNumbers: _licenseNumbers, ...rest } = entry;
  return { ...rest, matchType };
}

/**
 * Ranks exact, then starts-with, then contains matches on normalized values.
 * Only when none exist does it fall back to typo-tolerant matches, and then to "did you mean" names.
 */
export function matchCasinos(
  prepared: PreparedEntry[],
  query: string,
  limit: number,
): CasinoSearchResult {
  const terms = normalizedTerms(query);
  if (terms.length === 0) return { matches: [], suggestions: [] };

  const direct = prepared
    .map((item) => ({ item, type: directMatch(item, terms) }))
    .filter((row): row is { item: PreparedEntry; type: MatchType } => row.type !== null)
    .sort((a, b) => TIER[a.type] - TIER[b.type] || byRating(a.item.entry, b.item.entry));

  if (direct.length > 0) {
    return {
      matches: direct.slice(0, limit).map((row) => toMatch(row.item.entry, row.type)),
      suggestions: [],
    };
  }

  const scored = prepared
    .map((item) => ({ item, ...closeness(item, terms) }))
    .sort((a, b) => a.distance - b.distance || byRating(a.item.entry, b.item.entry));

  const fuzzy = scored.filter((row) => row.fuzzy);
  if (fuzzy.length > 0) {
    return {
      matches: fuzzy.slice(0, limit).map((row) => toMatch(row.item.entry, 'fuzzy')),
      suggestions: [],
    };
  }

  const suggestions = scored
    .filter((row) => row.suggest)
    .slice(0, SUGGESTION_LIMIT)
    .map((row) => row.item.entry.name);

  return { matches: [], suggestions };
}
