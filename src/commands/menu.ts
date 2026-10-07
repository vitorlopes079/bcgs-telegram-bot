import type { Bot } from 'grammy';
import { syncSavedLanguageCommands } from '../command-menu';
import type { BotContext } from '../context';
import { getLocale, t } from '../i18n';
import { menuActionFor, replyWithMainMenu, type MenuAction } from '../keyboard';
import { startComplaintFlow } from './complaint';
import { replyHelp } from './help';
import { showLanguageSelector } from './language';
import { replyLinks } from './links';
import { replyRankings } from './rankings';
import { replyReview } from './review';
import { replySearch } from './search';

const PENDING_TTL_MS = 5 * 60 * 1000;

type PendingInput = { action: 'search' | 'review'; expiresAt: number };
const pendingInputs = new Map<number, PendingInput>();

function setPending(userId: number, action: PendingInput['action']): void {
  const now = Date.now();
  for (const [id, entry] of pendingInputs) {
    if (entry.expiresAt <= now) pendingInputs.delete(id);
  }
  pendingInputs.set(userId, { action, expiresAt: now + PENDING_TTL_MS });
}

const actions: Record<MenuAction, (ctx: BotContext, userId: number) => Promise<void>> = {
  search: async (ctx, userId) => {
    setPending(userId, 'search');
    await ctx.reply(t('keyboard.askSearch', {}, getLocale(ctx)));
  },
  review: async (ctx, userId) => {
    setPending(userId, 'review');
    await ctx.reply(t('keyboard.askReview', {}, getLocale(ctx)));
  },
  rankings: (ctx) => replyRankings(ctx, ''),
  complaint: (ctx) => startComplaintFlow(ctx, 'complaint'),
  report: (ctx) => startComplaintFlow(ctx, 'scam_report'),
  links: replyLinks,
  language: (ctx) => showLanguageSelector(ctx),
  help: replyHelp,
};

/** Must be registered before the commands, so a command clears a pending Search/Reviews prompt. */
export function registerMainMenu(bot: Bot<BotContext>) {
  bot.on('message:text', async (ctx, next) => {
    if (ctx.chat.type !== 'private') return next();

    const userId = ctx.from.id;
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) {
      pendingInputs.delete(userId);
      return next();
    }

    const action = menuActionFor(text);
    if (action) {
      pendingInputs.delete(userId);
      await actions[action](ctx, userId);
      return;
    }

    const pending = pendingInputs.get(userId);
    if (!pending) return next();
    pendingInputs.delete(userId);
    if (pending.expiresAt <= Date.now()) return next();

    if (pending.action === 'search') await replySearch(ctx, text);
    else await replyReview(ctx, text);
  });

  bot.command('menu', async (ctx) => {
    if (ctx.chat.type !== 'private') {
      await replyHelp(ctx);
      return;
    }
    await replyWithMainMenu(ctx, t('keyboard.ready', {}, getLocale(ctx)));
    await syncSavedLanguageCommands(ctx);
  });
}
