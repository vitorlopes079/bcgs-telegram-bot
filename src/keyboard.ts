import { Keyboard } from 'grammy';
import { MAIN_KEYBOARD_LAYOUT, type MenuAction, type MenuButton } from './config/main-keyboard';
import type { BotContext } from './context';
import { getLocale, LOCALES, t, type Locale, type MessageKey } from './i18n';

export type { MenuAction } from './config/main-keyboard';

function buttonLabel(button: MenuButton, locale: Locale): string {
  const key: MessageKey = `keyboard.${button.action}`;
  return `${button.emoji} ${t(key, {}, locale)}`;
}

/** The persistent private-chat keyboard. Never send this in groups. */
export function mainKeyboard(locale: Locale): Keyboard {
  const keyboard = new Keyboard();
  MAIN_KEYBOARD_LAYOUT.forEach((row, index) => {
    if (index > 0) keyboard.row();
    for (const button of row) keyboard.text(buttonLabel(button, locale));
  });
  return keyboard.persistent().resized();
}

/** Sends `text` with the main keyboard attached. Does nothing outside private chats. */
export async function replyWithMainMenu(ctx: BotContext, text: string): Promise<void> {
  if (ctx.chat?.type !== 'private') return;
  await ctx.reply(text, { reply_markup: mainKeyboard(getLocale(ctx)) });
}

// Labels from every language, so an older keyboard still on screen keeps working after a language change.
const actionsByLabel = new Map<string, MenuAction>(
  LOCALES.flatMap((locale) =>
    MAIN_KEYBOARD_LAYOUT.flat().map((button) => [buttonLabel(button, locale), button.action] as const),
  ),
);

/** The menu action for a tapped button label, in any supported language. */
export function menuActionFor(text: string): MenuAction | undefined {
  return actionsByLabel.get(text.trim());
}
