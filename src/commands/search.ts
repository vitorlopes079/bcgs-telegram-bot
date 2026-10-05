import type { Bot } from 'grammy';
import type { BotContext } from '../context';
import { findCasinos } from '../services/casinos';
import { casinoUrl, formatRating } from '../site';
import { getLocale, t, type Locale } from '../i18n';

export async function buildSearchReply(query: string, locale: Locale = 'en'): Promise<string> {
  const casinos = await findCasinos(query, undefined, locale);

  if (casinos.length === 0) {
    return t('search.noResults', { query }, locale);
  }

  const entries = casinos.map((casino, index) =>
    [
      `${index + 1}. ${casino.name}`,
      t('search.rating', { rating: formatRating(casino.overallRating, locale) }, locale),
      t('search.license', {
        licenses: casino.licenses.join(', ') || t('search.noLicenses', {}, locale),
      }, locale),
      casinoUrl(casino.slug, locale),
    ].join('\n'),
  );

  return t('search.results', { query, entries: entries.join('\n\n') }, locale);
}

export function registerSearchCommand(bot: Bot<BotContext>) {
  bot.command('search', async (ctx) => {
    const query = ctx.match.trim();

    if (!query) {
      await ctx.reply(t('search.usage', {}, getLocale(ctx)));
      return;
    }

    try {
      const reply = await buildSearchReply(query, getLocale(ctx));
      await ctx.reply(reply, { link_preview_options: { is_disabled: true } });
    } catch (error) {
      console.error('/search failed.');
      await ctx.reply(t('common.genericError', {}, getLocale(ctx)));
    }
  });
}
