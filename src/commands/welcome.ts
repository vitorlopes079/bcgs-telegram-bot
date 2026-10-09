import { InlineKeyboard, type Keyboard } from 'grammy';
import type { BotContext } from '../context';
import { t, type Locale } from '../i18n';
import { mainKeyboard, replyWithMainMenu } from '../keyboard';
import { getWelcome, WELCOME_CAPTION_MAX, type Welcome } from '../services/welcome';
import { buildHelpReply } from './help';

/** Short reason for logs. Telegram errors don't carry the media URL, but strip any URL just in case. */
function describeError(error: unknown): string {
  const candidate = error as { error_code?: unknown; description?: unknown; message?: unknown };
  const detail = candidate?.description ?? candidate?.message ?? String(error);
  const code = typeof candidate?.error_code === 'number' ? `${candidate.error_code} ` : '';
  return `${code}${String(detail)}`.replace(/https?:\/\/\S+/g, '<url>').slice(0, 200);
}

function sendMedia(
  ctx: BotContext,
  media: NonNullable<Welcome['media']>,
  caption: string,
  markup: InlineKeyboard | Keyboard | undefined,
) {
  const other = { ...(caption ? { caption } : {}), ...(markup ? { reply_markup: markup } : {}) };
  if (media.type === 'photo') return ctx.replyWithPhoto(media.url, other);
  if (media.type === 'animation') return ctx.replyWithAnimation(media.url, other);
  return ctx.replyWithVideo(media.url, other);
}

/**
 * Sends the admin-edited welcome as plain text (no parse mode). Returns false if nothing
 * could be sent, so the caller falls back to the built-in welcome.
 */
async function sendCustomWelcome(ctx: BotContext, welcome: Welcome, locale: Locale): Promise<boolean> {
  const inline = welcome.buttons.length
    ? InlineKeyboard.from(welcome.buttons.map((button) => [InlineKeyboard.url(button.label, button.url)]))
    : null;
  // One keyboard per message: without inline buttons the bottom keyboard can ride on the last welcome message.
  const markup = inline ?? mainKeyboard(locale);

  if (welcome.media) {
    const caption = welcome.caption || welcome.text;
    const textAfterMedia = caption.length > WELCOME_CAPTION_MAX;
    try {
      // Text too long for a caption: the media goes alone and the text follows with the buttons. Text is never cut.
      await sendMedia(ctx, welcome.media, textAfterMedia ? '' : caption, textAfterMedia ? undefined : markup);
      if (!textAfterMedia) return true;
    } catch (error) {
      console.warn(`Welcome ${welcome.media.type} (${locale}) could not be sent, sending text instead: ${describeError(error)}`);
    }
  }

  const text = welcome.text || welcome.caption;
  if (!text) return false;
  try {
    await ctx.reply(text, { reply_markup: markup });
    return true;
  } catch (error) {
    console.warn(`Welcome text (${locale}) could not be sent, using the built-in welcome: ${describeError(error)}`);
    return false;
  }
}

/** Private-chat welcome: the admin-edited one when set, otherwise the built-in help with the bottom keyboard. */
export async function sendWelcome(ctx: BotContext, locale: Locale): Promise<void> {
  let welcome: Welcome | null = null;
  try {
    welcome = await getWelcome(locale);
  } catch {
    console.warn('Loading the welcome message failed; using the built-in welcome.');
  }

  if (!welcome || !(await sendCustomWelcome(ctx, welcome, locale))) {
    await replyWithMainMenu(ctx, buildHelpReply(false, locale));
    return;
  }
  if (welcome.buttons.length) await replyWithMainMenu(ctx, t('keyboard.ready', {}, locale));
}
