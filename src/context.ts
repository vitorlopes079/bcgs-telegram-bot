import type { ConversationFlavor } from '@grammyjs/conversations';
import type { Context } from 'grammy';
import type { Locale } from './i18n';

export type LocaleFlavor = {
  /** Saved language, else Telegram's language_code, else English. Set by the locale middleware. */
  locale?: Locale;
  /** Language the user chose with the selector; null when they never chose one. */
  savedLocale?: Locale | null;
};

export type BotContext = ConversationFlavor<Context & LocaleFlavor>;
