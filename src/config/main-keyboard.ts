/** Everything a main-menu button can do. Each needs a `keyboard.<action>` label in every catalog. */
export type MenuAction = 'search' | 'review' | 'rankings' | 'complaint' | 'report' | 'links' | 'language' | 'help';

export type MenuButton = { action: MenuAction; emoji: string };

/** Private-chat reply keyboard, row by row. Rearrange, add or remove buttons here; no other code changes needed. */
export const MAIN_KEYBOARD_LAYOUT: readonly (readonly MenuButton[])[] = [
  [
    { action: 'search', emoji: '🔍' },
    { action: 'review', emoji: '⭐' },
    { action: 'rankings', emoji: '🏆' },
  ],
  [
    { action: 'complaint', emoji: '📝' },
    { action: 'report', emoji: '🚨' },
  ],
  [
    { action: 'links', emoji: '🔗' },
    { action: 'language', emoji: '🌐' },
    { action: 'help', emoji: '❓' },
  ],
];
