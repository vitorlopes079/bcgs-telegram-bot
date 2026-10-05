import type { Bot } from 'grammy';
import { registerComplaintCommands, startComplaintFlow } from './commands/complaint';
import { buildHelpReply, registerHelpCommand } from './commands/help';
import { registerLinksCommand } from './commands/links';
import { registerRankingsCommand } from './commands/rankings';
import { registerReviewCommand } from './commands/review';
import { registerSearchCommand } from './commands/search';
import type { BotContext } from './context';
import { getLocale, t } from './i18n';

export function registerHandlers(bot: Bot<BotContext>) {
  // Must come first so an active complaint/report flow receives every message in its chat.
  registerComplaintCommands(bot);

  bot.command('start', async (ctx) => {
    const payload = typeof ctx.match === 'string' ? ctx.match.trim() : '';
    if (payload === 'complaint') {
      await startComplaintFlow(ctx, 'complaint');
      return;
    }
    if (payload === 'report') {
      await startComplaintFlow(ctx, 'scam_report');
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

export async function setBotCommands(bot: Bot<BotContext>): Promise<void> {
  const privateCommands = [
    { command: 'start', description: t('menu.start') },
    { command: 'help', description: t('menu.help') },
    { command: 'search', description: t('menu.search') },
    { command: 'review', description: t('menu.review') },
    { command: 'rankings', description: t('menu.rankings') },
    { command: 'links', description: t('menu.links') },
    { command: 'complaint', description: t('menu.complaint') },
    { command: 'report', description: t('menu.report') },
  ] as const;
  const groupCommands = [
    { command: 'help', description: t('menu.help') },
    { command: 'search', description: t('menu.search') },
    { command: 'review', description: t('menu.review') },
    { command: 'rankings', description: t('menu.rankings') },
    { command: 'links', description: t('menu.links') },
  ] as const;

  await Promise.all([
    bot.api.setMyCommands(privateCommands, { scope: { type: 'all_private_chats' } }),
    bot.api.setMyCommands(groupCommands, { scope: { type: 'all_group_chats' } }),
  ]);
}
