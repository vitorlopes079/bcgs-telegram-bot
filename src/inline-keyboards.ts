import { GrammyError, InlineKeyboard } from 'grammy';
import type { InlineKeyboardButton } from 'grammy/types';
import { encodeNav, type NavAction } from './callback-data';
import type { BotContext } from './context';
import type { Messages } from './i18n/en';
import { t, type Locale } from './i18n';
import { casinoUrl } from './site';

/** A message body plus its buttons, so the same screen can be sent fresh or edited in place. */
export type Screen = {
  text: string;
  keyboard?: InlineKeyboard;
  /** Send as a reply to the user's message: Back on a list re-reads the query from it. */
  replyToQuery?: boolean;
};

type ButtonKey = Exclude<keyof Messages['buttons'], 'unavailable'>;

const EMOJI: Record<ButtonKey, string> = {
  viewReview: '📖',
  visitWebsite: '🌐',
  submitComplaint: '📝',
  back: '⬅️',
  previous: '◀️',
  next: '▶️',
  website: '🌐',
  community: '💬',
  discord: '🎮',
};

type Row = InlineKeyboardButton[];

function label(key: ButtonKey, locale: Locale): string {
  return `${EMOJI[key]} ${t(`buttons.${key}`, {}, locale)}`;
}

function navButton(text: string, action: NavAction): InlineKeyboardButton | null {
  const data = encodeNav(action);
  return data ? InlineKeyboard.text(text, data) : null;
}

function urlButton(text: string, url: string | undefined): InlineKeyboardButton | null {
  return url ? InlineKeyboard.url(text, url) : null;
}

/** Drops missing buttons and empty rows; undefined when nothing is left. */
function keyboard(rows: (InlineKeyboardButton | null)[][]): InlineKeyboard | undefined {
  const kept = rows.map((row) => row.filter((button): button is InlineKeyboardButton => button !== null)).filter((row) => row.length > 0);
  return kept.length > 0 ? InlineKeyboard.from(kept as Row[]) : undefined;
}

/** In private chats this starts the flow; in groups it deep-links to the private chat, never starting the flow there. */
function complaintButton(ctx: BotContext, locale: Locale): InlineKeyboardButton | null {
  const text = label('submitComplaint', locale);
  if (ctx.chat?.type === 'private') return navButton(text, { kind: 'complaint' });
  return urlButton(text, ctx.me.username ? `https://t.me/${ctx.me.username}?start=complaint` : undefined);
}

function backRow(back: NavAction | undefined, locale: Locale): (InlineKeyboardButton | null)[] {
  return back ? [navButton(label('back', locale), back)] : [];
}

export function casinoCardKeyboard(ctx: BotContext, slug: string, locale: Locale, back?: NavAction) {
  const url = casinoUrl(slug, locale);
  return keyboard([
    [urlButton(label('viewReview', locale), url), urlButton(label('visitWebsite', locale), url)],
    [complaintButton(ctx, locale)],
    backRow(back, locale),
  ]);
}

export function reviewKeyboard(ctx: BotContext, slug: string, locale: Locale, back?: NavAction) {
  return keyboard([
    [urlButton(label('visitWebsite', locale), casinoUrl(slug, locale)), complaintButton(ctx, locale)],
    backRow(back, locale),
  ]);
}

/** One casino per row; the label is the casino name, the data only its slug. */
export function casinoListKeyboard(casinos: { slug: string; label: string }[], open: (slug: string) => NavAction) {
  return keyboard(casinos.map((casino) => [navButton(casino.label, open(casino.slug))]));
}

export function pagerRow(page: number, pageCount: number, toPage: (page: number) => NavAction, locale: Locale) {
  return [
    page > 1 ? navButton(label('previous', locale), toPage(page - 1)) : null,
    page < pageCount ? navButton(label('next', locale), toPage(page + 1)) : null,
  ];
}

export function rankingsKeyboard(
  casinos: { slug: string; label: string }[],
  open: (slug: string) => NavAction,
  pager: (InlineKeyboardButton | null)[],
) {
  return keyboard([...casinos.map((casino) => [navButton(casino.label, open(casino.slug))]), pager]);
}

export function linksKeyboard(links: { website: string; community?: string; discord?: string }, locale: Locale) {
  return keyboard([
    [urlButton(label('website', locale), links.website), urlButton(label('community', locale), links.community)],
    [urlButton(label('discord', locale), links.discord)],
  ]);
}

export async function sendScreen(ctx: BotContext, screen: Screen): Promise<void> {
  const messageId = ctx.message?.message_id;
  await ctx.reply(screen.text, {
    reply_markup: screen.keyboard,
    link_preview_options: { is_disabled: true },
    ...(screen.replyToQuery && messageId
      ? { reply_parameters: { message_id: messageId, allow_sending_without_reply: true } }
      : {}),
  });
}

/** Replaces the tapped message with `screen`; sends it as a new message if the old one can't be edited. */
export async function editScreen(ctx: BotContext, screen: Screen): Promise<void> {
  try {
    await ctx.editMessageText(screen.text, {
      reply_markup: screen.keyboard,
      link_preview_options: { is_disabled: true },
    });
  } catch (error) {
    if (error instanceof GrammyError && /message is not modified/i.test(error.description)) return;
    await ctx.reply(screen.text, { reply_markup: screen.keyboard, link_preview_options: { is_disabled: true } });
  }
}
