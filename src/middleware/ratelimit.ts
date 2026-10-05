import type { BotContext } from '../context';
import { getLocale, t } from '../i18n';

const MAX_GROUP_MESSAGES = 5;
const WINDOW_MS = 10_000;

type UserWindow = { startedAt: number; count: number; warned: boolean };
const userWindows = new Map<number, UserWindow>();

const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [userId, window] of userWindows) {
    if (now - window.startedAt >= WINDOW_MS) userWindows.delete(userId);
  }
}, WINDOW_MS);
cleanupInterval.unref();

export function stopRateLimitCleanup(): void {
  clearInterval(cleanupInterval);
}

export async function rateLimit(ctx: BotContext, next: () => Promise<void>): Promise<void> {
  if (!ctx.message || ctx.chat?.type === 'private' || !ctx.from) {
    await next();
    return;
  }

  const now = Date.now();
  let window = userWindows.get(ctx.from.id);
  if (!window || now - window.startedAt >= WINDOW_MS) {
    window = { startedAt: now, count: 0, warned: false };
    userWindows.set(ctx.from.id, window);
  }

  if (window.count < MAX_GROUP_MESSAGES) {
    window.count += 1;
    await next();
    return;
  }

  if (!window.warned) {
    window.warned = true;
    await ctx.reply(t('rateLimit.slowDown', {}, getLocale(ctx)));
  }
}
