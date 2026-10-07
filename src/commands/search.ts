import type { Bot } from 'grammy';
import type { CardAction, NavAction } from '../callback-data';
import type { BotContext } from '../context';
import { casinoCardKeyboard, casinoListKeyboard, sendScreen, type Screen } from '../inline-keyboards';
import { getCasinoBySlug, searchCasinos, type LocalizedCasinoMatch } from '../services/casinos';
import { casinoUrl, formatRating } from '../site';
import { getLocale, t, type Locale } from '../i18n';

function formatEntry(casino: LocalizedCasinoMatch, heading: string, locale: Locale): string {
  return [
    heading,
    t('search.rating', { rating: formatRating(casino.overallRating, locale) }, locale),
    t('search.license', {
      licenses: casino.licenses.join(', ') || t('search.noLicenses', {}, locale),
    }, locale),
    casinoUrl(casino.slug, locale),
  ].join('\n');
}

export async function buildSearchScreen(ctx: BotContext, query: string, locale: Locale): Promise<Screen> {
  const { matches: casinos, suggestions } = await searchCasinos(query, undefined, locale);

  if (casinos.length === 0) {
    return {
      text: suggestions.length > 0
        ? t('search.didYouMean', { query, names: suggestions.join('\n') }, locale)
        : t('search.noResults', { query }, locale),
    };
  }

  const entries = casinos.map((casino, index) => formatEntry(casino, `${index + 1}. ${casino.name}`, locale));
  const text = t('search.results', { query, entries: entries.join('\n\n') }, locale);

  if (casinos.length === 1) {
    return { text, keyboard: casinoCardKeyboard(ctx, { kind: 'card', slug: casinos[0].slug }, locale) };
  }
  return {
    text,
    keyboard: casinoListKeyboard(
      casinos.map((casino) => ({ slug: casino.slug, label: casino.name })),
      (slug) => ({ kind: 'searchCard', slug }),
    ),
    replyToQuery: true,
  };
}

function cardBack(card: CardAction): NavAction | undefined {
  switch (card.kind) {
    case 'card':
      return undefined;
    case 'searchCard':
      return { kind: 'searchBack' };
    case 'rankingsCard':
      return { kind: 'rankingsPage', page: card.page, category: card.category };
  }
}

/** A casino card opened from a button, with Back to where it was opened from; null if the casino is gone. */
export async function buildCasinoCardScreen(ctx: BotContext, card: CardAction, locale: Locale): Promise<Screen | null> {
  const casino = await getCasinoBySlug(card.slug, locale);
  if (!casino) return null;
  return {
    text: formatEntry(casino, casino.name, locale),
    keyboard: casinoCardKeyboard(ctx, card, locale, cardBack(card)),
  };
}

export async function replySearch(ctx: BotContext, query: string): Promise<void> {
  if (!query) {
    await ctx.reply(t('search.usage', {}, getLocale(ctx)));
    return;
  }

  try {
    await sendScreen(ctx, await buildSearchScreen(ctx, query, getLocale(ctx)));
  } catch (error) {
    console.error('/search failed.');
    await ctx.reply(t('common.genericError', {}, getLocale(ctx)));
  }
}

export function registerSearchCommand(bot: Bot<BotContext>) {
  bot.command('search', (ctx) => replySearch(ctx, ctx.match.trim()));
}
