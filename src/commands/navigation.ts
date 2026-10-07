import type { Bot } from 'grammy';
import { decodeNav, type NavAction } from '../callback-data';
import type { BotContext } from '../context';
import { getLocale, t, type Locale } from '../i18n';
import { editScreen, type Screen } from '../inline-keyboards';
import { startComplaintFlow } from './complaint';
import { buildRankingsScreen } from './rankings';
import { buildReviewScreen, buildReviewScreenBySlug } from './review';
import { buildCasinoCardScreen, buildSearchScreen } from './search';

/** The query of the /search or /review message a list replied to, without the command itself. */
function repliedQuery(ctx: BotContext): string | null {
  const message = ctx.callbackQuery?.message;
  const text = message && 'reply_to_message' in message ? message.reply_to_message?.text : undefined;
  const query = text?.replace(/^\/\S+\s*/, '').trim();
  return query || null;
}

async function screenFor(ctx: BotContext, action: NavAction, locale: Locale): Promise<Screen | null> {
  switch (action.kind) {
    case 'searchCard':
      return buildCasinoCardScreen(ctx, action.slug, locale);
    case 'searchBack': {
      const query = repliedQuery(ctx);
      return query ? buildSearchScreen(ctx, query, locale) : null;
    }
    case 'reviewOpen':
      return buildReviewScreenBySlug(ctx, action.slug, locale, { kind: 'reviewBack' });
    case 'reviewBack': {
      const query = repliedQuery(ctx);
      return query ? buildReviewScreen(ctx, query, locale) : null;
    }
    case 'rankingsPage':
      return buildRankingsScreen(ctx, action.category ?? '', action.page, locale, true);
    case 'rankingsReview':
      return buildReviewScreenBySlug(ctx, action.slug, locale, {
        kind: 'rankingsPage',
        page: action.page,
        category: action.category,
      });
    case 'complaint':
      return null;
  }
}

/** Register after every other callback handler: it also answers taps nothing else recognized. */
export function registerNavigation(bot: Bot<BotContext>) {
  bot.on('callback_query:data', async (ctx, next) => {
    const action = decodeNav(ctx.callbackQuery.data);
    if (!action) return next();
    const locale = getLocale(ctx);

    try {
      if (action.kind === 'complaint') {
        await ctx.answerCallbackQuery();
        // Groups only ever get a URL button; startComplaintFlow still refuses to run the flow outside private chats.
        await startComplaintFlow(ctx, 'complaint');
        return;
      }

      const screen = await screenFor(ctx, action, locale);
      if (!screen) {
        await ctx.answerCallbackQuery({ text: t('buttons.unavailable', {}, locale) });
        return;
      }
      await editScreen(ctx, screen);
      await ctx.answerCallbackQuery();
    } catch (error) {
      console.error('Inline button failed.');
      await ctx.answerCallbackQuery({ text: t('common.genericError', {}, locale) }).catch(() => {});
    }
  });

  bot.on('callback_query', (ctx) =>
    ctx.answerCallbackQuery({ text: t('buttons.unavailable', {}, getLocale(ctx)) }),
  );
}
