import type { Bot } from 'grammy';
import type { BotContext } from '../context';
import {
  findCategory,
  getTopCasinos,
  getTopCasinosInCategory,
  type RankedCasino,
} from '../services/rankings';
import { casinoUrl, formatRating } from '../site';
import { getLocale, t, type Locale } from '../i18n';

function formatList(title: string, casinos: RankedCasino[], locale: Locale): string {
  const entries = casinos.map((casino, index) =>
    t('rankings.rankedCasino', {
      rank: index + 1,
      name: casino.name,
      rating: formatRating(casino.overallRating, locale),
      url: casinoUrl(casino.slug, locale),
    }, locale),
  );
  return t('rankings.list', { title, entries: entries.join('\n\n') }, locale);
}

async function overallRankings(locale: Locale): Promise<string> {
  const casinos = await getTopCasinos(locale);

  if (casinos.length === 0) return t('rankings.noCasinos', {}, locale);
  return formatList(t('rankings.topOverall', { count: casinos.length }, locale), casinos, locale);
}

async function categoryRankings(input: string, locale: Locale): Promise<string> {
  const category = await findCategory(input, locale);

  if (!category) {
    return t('rankings.categoryNotFound', { input }, locale);
  }

  const categoryName = category.name;

  const casinos = await getTopCasinosInCategory(category.id, locale);

  if (casinos.length === 0) return t('rankings.noCategoryCasinos', { categoryName }, locale);
  return formatList(t('rankings.topCategory', { count: casinos.length, categoryName }, locale), casinos, locale);
}

export async function buildRankingsReply(input: string, locale: Locale = 'en'): Promise<string> {
  return input ? categoryRankings(input, locale) : overallRankings(locale);
}

export async function replyRankings(ctx: BotContext, input: string): Promise<void> {
  try {
    const reply = await buildRankingsReply(input, getLocale(ctx));
    await ctx.reply(reply, { link_preview_options: { is_disabled: true } });
  } catch (error) {
    console.error('/rankings failed.');
    await ctx.reply(t('common.genericError', {}, getLocale(ctx)));
  }
}

export function registerRankingsCommand(bot: Bot<BotContext>) {
  bot.command('rankings', (ctx) => replyRankings(ctx, ctx.match.trim()));
}
