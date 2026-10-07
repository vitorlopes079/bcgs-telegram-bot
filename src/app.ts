import type { Bot } from 'grammy';
import { registerComplaintCommands, startComplaintFlow } from './commands/complaint';
import { buildHelpReply, registerHelpCommand } from './commands/help';
import { registerLanguageCommand, showLanguageSelector } from './commands/language';
import { registerLinksCommand } from './commands/links';
import { registerRankingsCommand } from './commands/rankings';
import { registerReviewCommand } from './commands/review';
import { registerSearchCommand } from './commands/search';
import { syncSavedLanguageCommands } from './command-menu';
import { registerMainMenu } from './commands/menu';
import type { BotContext } from './context';
import { getLocale } from './i18n';
import { replyWithMainMenu } from './keyboard';

export function registerHandlers(bot: Bot<BotContext>) {
  // Must come first so an active complaint/report flow receives every message in its chat.
  registerComplaintCommands(bot);
  registerMainMenu(bot);

  bot.command('start', async (ctx) => {
    const payload = typeof ctx.match === 'string' ? ctx.match.trim() : '';
    if (ctx.chat.type === 'private') {
      if (payload === 'language') {
        await showLanguageSelector(ctx);
        return;
      }
      if (!ctx.savedLocale) {
        await showLanguageSelector(
          ctx,
          payload === 'complaint' ? 'complaint' : payload === 'report' ? 'report' : 'start',
        );
        return;
      }
    }

    if (payload === 'complaint') {
      await startComplaintFlow(ctx, 'complaint');
      return;
    }
    if (payload === 'report') {
      await startComplaintFlow(ctx, 'scam_report');
      return;
    }

    if (ctx.chat.type === 'private') {
      await replyWithMainMenu(ctx, buildHelpReply(false, getLocale(ctx)));
      await syncSavedLanguageCommands(ctx);
      return;
    }
    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
    await ctx.reply(buildHelpReply(isGroup, getLocale(ctx)));
  });

  registerHelpCommand(bot);
  registerSearchCommand(bot);
  registerRankingsCommand(bot);
  registerReviewCommand(bot);
  registerLinksCommand(bot);
  registerLanguageCommand(bot);

  bot.catch((err) => {
    if (isTelegramConflict(err.error)) {
      console.warn('Telegram polling conflict (409 Conflict): another instance may be running with the same bot token.');
      return;
    }
    console.error(`Error handling update ${err.ctx.update.update_id}.`);
  });
}

function isTelegramConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { error_code?: unknown; message?: unknown; description?: unknown };
  if (candidate.error_code === 409) return true;
  return [candidate.message, candidate.description].some(
    (message) => typeof message === 'string' && /409\s*[:|-]?\s*Conflict|Conflict.*getUpdates/i.test(message),
  );
}
