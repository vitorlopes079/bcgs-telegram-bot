import { prisma } from '../prisma';
import { isLocale, type Locale } from '../i18n';

const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 10_000;

// null is cached too, so users who never chose a language don't cost a query per message.
type CacheEntry = { locale: Locale | null; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<Locale | null>>();

function isFresh(entry: CacheEntry | undefined): entry is CacheEntry {
  return entry !== undefined && entry.expiresAt > Date.now();
}

function remember(telegramUserId: string, locale: Locale | null): void {
  if (cache.size >= MAX_CACHE_ENTRIES && !cache.has(telegramUserId)) {
    for (const [id, entry] of cache) {
      if (!isFresh(entry)) cache.delete(id);
    }
    if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  }
  cache.delete(telegramUserId);
  cache.set(telegramUserId, { locale, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** The language the user chose with the selector, or null if they never chose one. */
export async function getSavedLocale(telegramUserId: string): Promise<Locale | null> {
  const cached = cache.get(telegramUserId);
  if (isFresh(cached)) return cached.locale;

  let load = pending.get(telegramUserId);
  if (!load) {
    load = prisma.telegramUserSetting
      .findUnique({ where: { telegramUserId }, select: { language: true } })
      .then((row) => {
        const locale = isLocale(row?.language) ? row.language : null;
        // A choice saved while this read was in flight is newer; keep it.
        if (!isFresh(cache.get(telegramUserId))) remember(telegramUserId, locale);
        return locale;
      })
      .finally(() => pending.delete(telegramUserId));
    pending.set(telegramUserId, load);
  }
  return load;
}

export async function saveLocale(telegramUserId: string, locale: Locale): Promise<void> {
  await prisma.telegramUserSetting.upsert({
    where: { telegramUserId },
    create: { telegramUserId, language: locale },
    update: { language: locale },
    select: { telegramUserId: true },
  });
  remember(telegramUserId, locale);
}
