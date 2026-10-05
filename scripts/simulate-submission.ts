import 'dotenv/config';
import { Bot } from 'grammy';
import type { Update } from 'grammy/types';
import { registerHandlers } from '../src/app';
import type { BotContext } from '../src/context';
import { prisma } from '../src/prisma';

// Fake token + fake fetch: no request can ever reach Telegram.
const replies: string[] = [];
let messageId = 1000;
const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
  const method = String(url).split('/').pop();
  const payload = init?.body ? JSON.parse(String(init.body)) : {};
  if (method === 'sendMessage') replies.push(payload.text);
  else replies.push(`[${method}]`);
  return new Response(
    JSON.stringify({
      ok: true,
      result: { message_id: messageId++, date: 0, chat: { id: payload.chat_id, type: 'private' }, text: payload.text },
    }),
  );
}) as typeof fetch;

const bot = new Bot<BotContext>('000000:SIMULATION', {
  botInfo: {
    id: 1, is_bot: true, first_name: 'Sim', username: 'sim_bot',
    can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false,
    can_connect_to_business: false, has_main_web_app: false,
  } as never,
  client: { fetch: fakeFetch },
});
registerHandlers(bot);

let clockOffset = 0;
const realNow = Date.now.bind(Date);
Date.now = () => realNow() + clockOffset;

let updateId = 1;
type Input = string | { photo: true } | { document: true };

function makeUpdate(chatId: number, input: Input, chatType = 'private'): Update {
  const base = {
    message_id: updateId,
    date: Math.floor(Date.now() / 1000),
    chat: chatType === 'private'
      ? { id: chatId, type: 'private', first_name: 'Tester' }
      : { id: chatId, type: chatType, title: 'Group' },
    from: { id: 777000111, is_bot: false, first_name: 'Tester' },
  };
  let message: Record<string, unknown>;
  if (typeof input === 'string') {
    const command = input.match(/^\/\S+/);
    message = {
      ...base,
      text: input,
      ...(command ? { entities: [{ type: 'bot_command', offset: 0, length: command[0].length }] } : {}),
    };
  } else if ('photo' in input) {
    message = { ...base, photo: [
      { file_id: `PHOTO_SMALL_${updateId}`, file_unique_id: `ps${updateId}`, width: 90, height: 90 },
      { file_id: `PHOTO_LARGE_${updateId}`, file_unique_id: `pl${updateId}`, width: 1280, height: 1280 },
    ] };
  } else {
    message = { ...base, document: { file_id: `DOC_${updateId}`, file_unique_id: `d${updateId}`, file_name: 'statement.pdf' } };
  }
  return { update_id: updateId++, message } as unknown as Update;
}

async function scenario(title: string, chatId: number, inputs: (Input | { advanceMinutes: number })[], chatType = 'private') {
  console.log(`\n======== ${title} ========`);
  for (const input of inputs) {
    if (typeof input === 'object' && 'advanceMinutes' in input) {
      clockOffset += input.advanceMinutes * 60 * 1000;
      console.log(`   ⏱  (${input.advanceMinutes} minutes pass)`);
      continue;
    }
    console.log(`👤 ${typeof input === 'string' ? input : 'photo' in input ? '[photo]' : '[document]'}`);
    replies.length = 0;
    await bot.handleUpdate(makeUpdate(chatId, input, chatType));
    for (const reply of replies) console.log(`🤖 ${reply.replaceAll('\n', '\n   ')}`);
  }
}

const scenarios: Record<string, () => Promise<void>> = {
  dry: async () => {
    await scenario('Group chat is refused', -100, ['/complaint'], 'supergroup');
    await scenario('/cancel with no active flow', 1, ['/cancel']);
    await scenario('/cancel mid-flow', 2, ['/complaint', 'stake', '/cancel', '/links']);
    await scenario('Report: multiple matches, attachments, bad email, "no" at confirm', 3, [
      '/report', 'bet', '2', 'Account locked after big win', '/search stake',
      'They closed my account right after I won and kept my balance.',
      { photo: true }, { document: true }, 'done', 'not-an-email', 'skip', 'no',
    ]);
    await scenario('Unknown casino + 30-minute timeout', 4, [
      '/complaint', 'Totally Unknown Casino XYZ', { advanceMinutes: 31 }, 'Subject after timeout', '/cancel',
    ]);
    await scenario('Full "yes" path (exercises the real save)', 5, [
      '/complaint', 'Stake', 'yes', 'Withdrawal not processed after 30 days',
      'Requested a withdrawal on Sep 1; still pending with no response from support.',
      'skip', 'test@example.com', 'yes',
    ]);
  },
};

(async () => {
  await scenarios[process.argv[2] ?? 'dry']();
  await prisma.$disconnect();
})();
