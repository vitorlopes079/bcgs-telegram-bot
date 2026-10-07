import type { Bot } from 'grammy';
import type { NavAction } from '../callback-data';
import type { BotContext } from '../context';
import { pagerRow, rankingsKeyboard, sendScreen, type Screen } from '../inline-keyboards';
import {
  findCategory,
  getTopCasinos,
  getTopCasinosInCategory,
  type RankedCasino,
} from '../services/rankings';
import { casinoUrl, formatRating } from '../site';
import { getLocale, t, type Locale } from '../i18n';

const PAGE_SIZE = 5;

function formatList(title: string, casinos: RankedCasino[], firstRank: number, locale: Locale): string {
  const entries = casinos.map((casino, index) =>
    t('rankings.rankedCasino', {
      rank: firstRank + index,
      name: casino.name,
      rating: formatRating(casino.overallRating, locale),
      url: casinoUrl(casino.slug, locale),
    }, locale),
  );
  return t('rankings.list', { title, entries: entries.join('\n\n') }, locale);
}

/**
 * One page of the overall rankings (empty `input`) or a category's (name or slug).
 * From a button (`fromButton`), a category or page that no longer exists returns null instead of an error text.
 */
export async function buildRankingsScreen(
  ctx: BotContext,
  input: string,
  page: number,
  locale: Locale,
  fromButton = false,
): Promise<Screen | null> {
  const category = input ? await findCategory(input, locale) : null;
  if (input && !category) {
    return fromButton ? null : { text: t('rankings.categoryNotFound', { input }, locale) };
  }

  const casinos = category ? await getTopCasinosInCategory(category.id, locale) : await getTopCasinos(locale);
  if (casinos.length === 0) {
    if (fromButton && page > 1) return null;
    return {
      text: category
        ? t('rankings.noCategoryCasinos', { categoryName: category.name }, locale)
        : t('rankings.noCasinos', {}, locale),
    };
  }

  const pageCount = Math.ceil(casinos.length / PAGE_SIZE);
  if (page < 1 || page > pageCount) return null;

  const firstIndex = (page - 1) * PAGE_SIZE;
  const pageCasinos = casinos.slice(firstIndex, firstIndex + PAGE_SIZE);
  const title = category
    ? t('rankings.topCategory', { count: casinos.length, categoryName: category.name }, locale)
    : t('rankings.topOverall', { count: casinos.length }, locale);
  const categorySlug = category?.slug;
  const toPage = (target: number): NavAction => ({ kind: 'rankingsPage', page: target, category: categorySlug });

  return {
    text: formatList(title, pageCasinos, firstIndex + 1, locale),
    keyboard: rankingsKeyboard(
      pageCasinos.map((casino, index) => ({ slug: casino.slug, label: `${firstIndex + index + 1}. ${casino.name}` })),
      (slug) => ({ kind: 'rankingsReview', page, slug, category: categorySlug }),
      pagerRow(page, pageCount, toPage, locale),
    ),
  };
}

export async function replyRankings(ctx: BotContext, input: string): Promise<void> {
  try {
    const screen = await buildRankingsScreen(ctx, input, 1, getLocale(ctx));
    if (screen) await sendScreen(ctx, screen);
  } catch (error) {
    console.error('/rankings failed.');
    await ctx.reply(t('common.genericError', {}, getLocale(ctx)));
  }
}

export function registerRankingsCommand(bot: Bot<BotContext>) {
  bot.command('rankings', (ctx) => replyRankings(ctx, ctx.match.trim()));
}
