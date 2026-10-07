import type { Bot } from 'grammy';
import type { BotContext } from '../context';
import { getCommunityLinks } from '../services/settings';
import { SITE_URL } from '../site';
import { getLocale, t, type Locale } from '../i18n';

export async function buildLinksReply(locale: Locale = 'en'): Promise<string> {
  const { telegram, discord } = await getCommunityLinks();

  const lines = [t('links.title', {}, locale), '', t('links.website', { url: SITE_URL }, locale)];
  if (telegram) lines.push(t('links.community', { url: telegram }, locale));
  if (discord) lines.push(t('links.discord', { url: discord }, locale));

  return lines.join('\n');
}

export async function replyLinks(ctx: BotContext): Promise<void> {
  try {
    const reply = await buildLinksReply(getLocale(ctx));
    await ctx.reply(reply, { link_preview_options: { is_disabled: true } });
  } catch (error) {
    console.error('/links failed.');
    await ctx.reply(t('common.genericError', {}, getLocale(ctx)));
  }
}

export function registerLinksCommand(bot: Bot<BotContext>) {
  bot.command('links', replyLinks);
}
