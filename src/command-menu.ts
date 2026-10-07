import type { Api, Bot } from 'grammy';
import type { BotContext } from './context';
import { DEFAULT_LOCALE, LOCALES, t, type Locale } from './i18n';

const MAX_SYNCED_CHATS = 10_000;

function privateCommands(locale: Locale) {
  return [
    { command: 'menu', description: t('menu.menu', {}, locale) },
    { command: 'start', description: t('menu.start', {}, locale) },
    { command: 'help', description: t('menu.help', {}, locale) },
    { command: 'search', description: t('menu.search', {}, locale) },
    { command: 'review', description: t('menu.review', {}, locale) },
    { command: 'rankings', description: t('menu.rankings', {}, locale) },
    { command: 'links', description: t('menu.links', {}, locale) },
    { command: 'complaint', description: t('menu.complaint', {}, locale) },
    { command: 'report', description: t('menu.report', {}, locale) },
    { command: 'language', description: t('menu.language', {}, locale) },
  ];
}

function groupCommands(locale: Locale) {
  return [
    { command: 'help', description: t('menu.help', {}, locale) },
    { command: 'search', description: t('menu.search', {}, locale) },
    { command: 'review', description: t('menu.review', {}, locale) },
    { command: 'rankings', description: t('menu.rankings', {}, locale) },
    { command: 'links', description: t('menu.links', {}, locale) },
  ];
}

export async function setBotCommands(bot: Bot<BotContext>): Promise<void> {
  // English is the default list; every other locale is set for users whose Telegram app uses that language.
  await Promise.all([
    bot.api.setChatMenuButton({ menu_button: { type: 'commands' } }),
    ...LOCALES.flatMap((locale) => {
      const language = locale === DEFAULT_LOCALE ? {} : { language_code: locale };
      return [
        bot.api.setMyCommands(privateCommands(locale), { scope: { type: 'all_private_chats' }, ...language }),
        bot.api.setMyCommands(groupCommands(locale), { scope: { type: 'all_group_chats' }, ...language }),
      ];
    }),
  ]);
}

// In memory only: after a restart each chat is re-synced once, on its next /start or /menu.
const syncedChats = new Map<number, Locale>();

/** Sets the private chat's command menu to the language chosen in the bot, unless it already is. */
export async function syncChatCommands(api: Api, chatId: number, locale: Locale, force = false): Promise<void> {
  if (!force && syncedChats.get(chatId) === locale) return;
  try {
    await api.setMyCommands(privateCommands(locale), { scope: { type: 'chat', chat_id: chatId } });
  } catch {
    console.warn('Failed to set chat command menu.');
    return;
  }
  if (syncedChats.size >= MAX_SYNCED_CHATS && !syncedChats.has(chatId)) {
    const oldest = syncedChats.keys().next().value;
    if (oldest !== undefined) syncedChats.delete(oldest);
  }
  syncedChats.set(chatId, locale);
}

/** For a returning user in private chat, make sure the command menu matches their saved language. */
export async function syncSavedLanguageCommands(ctx: BotContext): Promise<void> {
  if (ctx.chat?.type === 'private' && ctx.savedLocale) {
    await syncChatCommands(ctx.api, ctx.chat.id, ctx.savedLocale);
  }
}
