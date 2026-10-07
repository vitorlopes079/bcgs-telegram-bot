import 'dotenv/config';
import { Bot } from 'grammy';
import { registerHandlers } from './app';
import { refreshSavedChatCommands, setBotCommands } from './command-menu';
import type { BotContext } from './context';
import { resolveLocale } from './middleware/locale';
import { rateLimit, stopRateLimitCleanup } from './middleware/ratelimit';
import { prisma } from './prisma';

const token = process.env.BOT_TOKEN?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();
const missingEnvVars = [
  ...(!token ? ['BOT_TOKEN'] : []),
  ...(!databaseUrl ? ['DATABASE_URL'] : []),
];
if (missingEnvVars.length > 0) {
  for (const name of missingEnvVars) {
    console.error(`Missing required environment variable: ${name}`);
  }
  process.exit(1);
}

const adminChatId = process.env.ADMIN_CHAT_ID?.trim();
if (!adminChatId) {
  console.warn('ADMIN_CHAT_ID is not set; admin notifications are disabled.');
} else if (!/^-?\d+$/.test(adminChatId) || !Number.isSafeInteger(Number(adminChatId))) {
  console.error('ADMIN_CHAT_ID must be a valid integer.');
  process.exit(1);
}

const bot = new Bot<BotContext>(token!);

// Before the rate limiter so its group warning is in the user's language.
bot.use(resolveLocale);
bot.use(rateLimit);
registerHandlers(bot);

function isTelegramConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { error_code?: unknown; message?: unknown; description?: unknown };
  if (candidate.error_code === 409) return true;
  return [candidate.message, candidate.description].some(
    (message) => typeof message === 'string' && /409\s*[:|-]?\s*Conflict|Conflict.*getUpdates/i.test(message),
  );
}

let shuttingDown = false;
const SHUTDOWN_TIMEOUT_MS = 10_000;

async function shutdown(exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  const hardTimeout = setTimeout(() => process.exit(exitCode), SHUTDOWN_TIMEOUT_MS);

  try {
    await bot.stop();
  } catch {}
  try {
    await prisma.$disconnect();
  } catch {}
  stopRateLimitCleanup();

  clearTimeout(hardTimeout);
  process.exit(exitCode);
}

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

void bot.start({
  onStart: async (botInfo) => {
    console.log(`Bot is running as @${botInfo.username}`);
    try {
      await setBotCommands(bot);
    } catch (error) {
      console.warn('Failed to set bot command menus.');
    }
    void refreshSavedChatCommands(bot.api)
      .then((count) => console.log(`Refreshed ${count} chat command menus.`))
      .catch(() => console.warn('Failed to refresh chat command menus.'));
  },
}).catch((error: unknown) => {
  if (isTelegramConflict(error)) {
    console.warn('Telegram polling conflict (409 Conflict): another instance may be running with the same bot token.');
  } else {
    console.error('Bot polling failed.');
  }
  void shutdown(1);
});
