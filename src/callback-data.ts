// Every inline-button callback format lives here. Telegram caps callback data at 64 bytes,
// so buttons carry only ids/slugs and short codes; all state is in the data, so buttons survive a restart.
//
//   s:<slug>                       open a casino card from a /search list (Back = sb)
//   sb                             back to the /search list (query is read from the message being replied to)
//   r:<slug>                       open a casino review from a /review list (Back = rb)
//   rb                             back to the /review list (same as sb)
//   k:<page>[:<category>]          rankings page, overall or for a category slug
//   kr:<page>:<slug>[:<category>]  open a casino review from that rankings page (Back = k:<page>[:<category>])
//   cp                             start the complaint flow (private chats only; groups get a URL button)
//   lang:<locale>[:<after>]        language choice (see commands/language.ts)

export const MAX_CALLBACK_BYTES = 64;

export type NavAction =
  | { kind: 'searchCard'; slug: string }
  | { kind: 'searchBack' }
  | { kind: 'reviewOpen'; slug: string }
  | { kind: 'reviewBack' }
  | { kind: 'rankingsPage'; page: number; category?: string }
  | { kind: 'rankingsReview'; page: number; slug: string; category?: string }
  | { kind: 'complaint' };

const SLUG = '[^:\\s]+';
const PAGE = '[1-9]\\d{0,2}';

function fits(data: string): string | null {
  return Buffer.byteLength(data, 'utf8') <= MAX_CALLBACK_BYTES ? data : null;
}

/** Callback data for an action, or null if it wouldn't fit in 64 bytes (the button is then left out). */
export function encodeNav(action: NavAction): string | null {
  const category = 'category' in action && action.category ? `:${action.category}` : '';
  switch (action.kind) {
    case 'searchCard':
      return fits(`s:${action.slug}`);
    case 'searchBack':
      return 'sb';
    case 'reviewOpen':
      return fits(`r:${action.slug}`);
    case 'reviewBack':
      return 'rb';
    case 'rankingsPage':
      return fits(`k:${action.page}${category}`);
    case 'rankingsReview':
      return fits(`kr:${action.page}:${action.slug}${category}`);
    case 'complaint':
      return 'cp';
  }
}

const patterns: [RegExp, (m: RegExpMatchArray) => NavAction][] = [
  [new RegExp(`^s:(${SLUG})$`), (m) => ({ kind: 'searchCard', slug: m[1] })],
  [/^sb$/, () => ({ kind: 'searchBack' })],
  [new RegExp(`^r:(${SLUG})$`), (m) => ({ kind: 'reviewOpen', slug: m[1] })],
  [/^rb$/, () => ({ kind: 'reviewBack' })],
  [new RegExp(`^k:(${PAGE})(?::(${SLUG}))?$`), (m) => ({ kind: 'rankingsPage', page: Number(m[1]), category: m[2] })],
  [
    new RegExp(`^kr:(${PAGE}):(${SLUG})(?::(${SLUG}))?$`),
    (m) => ({ kind: 'rankingsReview', page: Number(m[1]), slug: m[2], category: m[3] }),
  ],
  [/^cp$/, () => ({ kind: 'complaint' })],
];

/** The action for callback data, or null if it isn't a navigation button (or is malformed). */
export function decodeNav(data: string): NavAction | null {
  for (const [pattern, build] of patterns) {
    const match = data.match(pattern);
    if (match) return build(match);
  }
  return null;
}

export const LANGUAGE_CALLBACK_PATTERN = /^lang:([a-z]+)(?::(start|complaint|report))?$/;

export function encodeLanguage(locale: string, after?: string): string {
  return after ? `lang:${locale}:${after}` : `lang:${locale}`;
}
