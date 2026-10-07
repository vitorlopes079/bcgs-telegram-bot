import type { Api, Bot } from 'grammy';
import type { BotContext } from './context';
import { DEFAULT_LOCALE, isLocale, LOCALES, t, type Locale } from './i18n';
import { prisma } from './prisma';

const MAX_SYNCED_CHATS = 10_000;
const REFRESH_PAGE_SIZE = 500;
// Well under Telegram's ~30 requests/second bot limit, so the startup refresh never slows normal replies.
const REFRESH_DELAY_MS = 60;

/** Private chats list only these; everything else is on the bottom keyboard and still works when typed. */
function privateCommands(locale: Locale) {
  return [
    { command: 'menu', description: t('menu.menu', {}, locale) },
    { command: 'start', description: t('menu.start', {}, locale) },
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
  // The default scope is cleared: private and group chats have their own lists, so it only held a stale long one.
  await Promise.all([
    bot.api.setChatMenuButton({ menu_button: { type: 'commands' } }),
    ...LOCALES.flatMap((locale) => {
      const language = locale === DEFAULT_LOCALE ? {} : { language_code: locale };
      return [
        bot.api.setMyCommands(privateCommands(locale), { scope: { type: 'all_private_chats' }, ...language }),
        bot.api.setMyCommands(groupCommands(locale), { scope: { type: 'all_group_chats' }, ...language }),
        bot.api.deleteMyCommands({ scope: { type: 'default' }, ...language }),
      ];
    }),
  ]);
}

// In memory only: after a restart each chat is re-synced once, on its next /start or /menu.
const syncedChats = new Map<number, Locale>();

function rememberSynced(chatId: number, locale: Locale): void {
  if (syncedChats.size >= MAX_SYNCED_CHATS && !syncedChats.has(chatId)) {
    const oldest = syncedChats.keys().next().value;
    if (oldest !== undefined) syncedChats.delete(oldest);
  }
  syncedChats.set(chatId, locale);
}

/** Sets the private chat's command menu to the language chosen in the bot, unless it already is. */
export async function syncChatCommands(api: Api, chatId: number, locale: Locale, force = false): Promise<void> {
  if (!force && syncedChats.get(chatId) === locale) return;
  try {
    await api.setMyCommands(privateCommands(locale), { scope: { type: 'chat', chat_id: chatId } });
  } catch {
    console.warn('Failed to set chat command menu.');
    return;
  }
  rememberSynced(chatId, locale);
}

/** For a returning user in private chat, make sure the command menu matches their saved language. */
export async function syncSavedLanguageCommands(ctx: BotContext): Promise<void> {
  if (ctx.chat?.type === 'private' && ctx.savedLocale) {
    await syncChatCommands(ctx.api, ctx.chat.id, ctx.savedLocale);
  }
}

/**
 * Per-chat lists were only ever set for users who chose a language, so rewriting the list for every saved
 * TelegramUserSetting replaces any long list left from an older version. Read-only; run in the background.
 */
export async function refreshSavedChatCommands(api: Api, delayMs = REFRESH_DELAY_MS): Promise<number> {
  let refreshed = 0;
  let cursor: string | undefined;
  while (true) {
    const rows = await prisma.telegramUserSetting.findMany({
      select: { telegramUserId: true, language: true },
      orderBy: { telegramUserId: 'asc' },
      take: REFRESH_PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { telegramUserId: cursor } } : {}),
    });
    for (const row of rows) {
      const chatId = Number(row.telegramUserId);
      if (!isLocale(row.language) || !Number.isSafeInteger(chatId) || chatId <= 0) continue;
      // Already set since startup (e.g. a language change mid-refresh): that list is newer than this row.
      if (syncedChats.has(chatId)) continue;
      try {
        // A user who blocked the bot just fails here; nothing else to do for them.
        await api.setMyCommands(privateCommands(row.language), { scope: { type: 'chat', chat_id: chatId } });
        rememberSynced(chatId, row.language);
        refreshed += 1;
      } catch {}
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    if (rows.length < REFRESH_PAGE_SIZE) return refreshed;
    cursor = rows.at(-1)!.telegramUserId;
  }
}
