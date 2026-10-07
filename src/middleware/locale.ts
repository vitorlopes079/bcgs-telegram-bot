import type { BotContext } from '../context';
import { DEFAULT_LOCALE, localeFromLanguageCode } from '../i18n';
import { getSavedLocale } from '../services/user-language';

export async function resolveLocale(ctx: BotContext, next: () => Promise<void>): Promise<void> {
  let saved = null;
  if (ctx.from && !ctx.from.is_bot) {
    try {
      saved = await getSavedLocale(String(ctx.from.id));
    } catch {
      console.warn('Could not load saved language.');
    }
  }

  ctx.savedLocale = saved;
  ctx.locale = saved ?? localeFromLanguageCode(ctx.from?.language_code) ?? DEFAULT_LOCALE;
  await next();
}
