import { InlineKeyboard, type Bot } from 'grammy';
import type { BotContext } from '../context';
import { getLocale, isLocale, LOCALES, t } from '../i18n';
import { saveLocale } from '../services/user-language';
import { startComplaintFlow } from './complaint';
import { buildHelpReply } from './help';

/** What to do after the user picks a language from a /start selector. */
export type AfterLanguageChoice = 'start' | 'complaint' | 'report';

const CALLBACK_PATTERN = /^lang:([a-z]+)(?::(start|complaint|report))?$/;

function languageKeyboard(after?: AfterLanguageChoice): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const locale of LOCALES) {
    keyboard.text(t('language.name', {}, locale), after ? `lang:${locale}:${after}` : `lang:${locale}`);
  }
  return keyboard;
}

export async function showLanguageSelector(ctx: BotContext, after?: AfterLanguageChoice): Promise<void> {
  // The user may not read the current locale yet, so the prompt is shown in every language.
  const prompt = LOCALES.map((locale) => t('language.choose', {}, locale)).join('\n');
  await ctx.reply(prompt, { reply_markup: languageKeyboard(after) });
}

export function registerLanguageCommand(bot: Bot<BotContext>) {
  bot.command('language', async (ctx) => {
    if (ctx.chat.type !== 'private') {
      const locale = getLocale(ctx);
      const url = `https://t.me/${ctx.me.username}?start=language`;
      await ctx.reply(t('language.privateOnly', {}, locale), {
        reply_markup: new InlineKeyboard().url(t('complaint.openPrivateChat', {}, locale), url),
      });
      return;
    }
    await showLanguageSelector(ctx);
  });

  bot.callbackQuery(CALLBACK_PATTERN, async (ctx) => {
    const [, locale, after] = ctx.match;
    if (!isLocale(locale) || ctx.chat?.type !== 'private') {
      await ctx.answerCallbackQuery();
      return;
    }

    try {
      await saveLocale(String(ctx.from.id), locale);
    } catch {
      console.error('Saving language failed.');
      await ctx.answerCallbackQuery({ text: t('common.genericError', {}, locale) });
      return;
    }
    ctx.locale = locale;
    ctx.savedLocale = locale;
    await ctx.answerCallbackQuery();

    const confirmation = t('language.saved', {}, locale);
    try {
      await ctx.editMessageText(confirmation);
    } catch {
      await ctx.reply(confirmation);
    }

    if (after === 'start') await ctx.reply(buildHelpReply(false, locale));
    else if (after === 'complaint') await startComplaintFlow(ctx, 'complaint');
    else if (after === 'report') await startComplaintFlow(ctx, 'scam_report');
  });
}
