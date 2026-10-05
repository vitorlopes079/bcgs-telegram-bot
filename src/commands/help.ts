import type { Bot } from 'grammy';
import type { BotContext } from '../context';
import { getLocale, t, type Locale } from '../i18n';

export function buildHelpReply(inGroup: boolean, locale: Locale = 'en'): string {
  return inGroup ? t('help.group', {}, locale) : t('help.private', {}, locale);
}

export function registerHelpCommand(bot: Bot<BotContext>) {
  bot.command('help', async (ctx) => {
    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
    await ctx.reply(buildHelpReply(isGroup, getLocale(ctx)));
  });
}
