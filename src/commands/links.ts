import type { Bot } from 'grammy';
import type { BotContext } from '../context';
import { linksKeyboard, sendScreen, type Screen } from '../inline-keyboards';
import { getCommunityLinks } from '../services/settings';
import { SITE_URL } from '../site';
import { getLocale, t, type Locale } from '../i18n';

export async function buildLinksScreen(locale: Locale = 'en'): Promise<Screen> {
  const { telegram, discord } = await getCommunityLinks();

  const lines = [t('links.title', {}, locale), '', t('links.website', { url: SITE_URL }, locale)];
  if (telegram) lines.push(t('links.community', { url: telegram }, locale));
  if (discord) lines.push(t('links.discord', { url: discord }, locale));

  return {
    text: lines.join('\n'),
    keyboard: linksKeyboard({ website: SITE_URL, community: telegram, discord }, locale),
  };
}

export async function replyLinks(ctx: BotContext): Promise<void> {
  try {
    await sendScreen(ctx, await buildLinksScreen(getLocale(ctx)));
  } catch (error) {
    console.error('/links failed.');
    await ctx.reply(t('common.genericError', {}, getLocale(ctx)));
  }
}

export function registerLinksCommand(bot: Bot<BotContext>) {
  bot.command('links', replyLinks);
}
