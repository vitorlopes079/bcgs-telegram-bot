// Offline i18n test: Prisma and Telegram are both stubbed, so nothing reaches the database or Telegram.
// Run with: node --import tsx scripts/test-i18n.ts
import {
  advanceMinutes, calls, check, createOfflineBot, db, finish, lastKeyboard, settings, tapUpdate, texts, textUpdate,
  type User,
} from './offline-harness';

(async () => {
  const { bot, send } = await createOfflineBot();
  const { setBotCommands } = await import('../src/command-menu');
  const en = (await import('../src/i18n/en')).default;
  const zh = (await import('../src/i18n/zh')).default;
  const th = (await import('../src/i18n/th')).default;
  const { t } = await import('../src/i18n');

  console.log('\n== Catalogs: placeholders and line breaks match English ==');
  const flatten = (obj: any, prefix = ''): [string, string][] =>
    Object.entries(obj).flatMap(([k, v]) => (typeof v === 'string' ? [[prefix + k, v] as [string, string]] : flatten(v, `${prefix}${k}.`)));
  const placeholders = (s: string) => [...s.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]).sort().join(',');
  const englishEntries = new Map(flatten(en));
  for (const [name, catalog] of [['zh', zh], ['th', th]] as const) {
    const mismatched = flatten(catalog).filter(([key, value]) => {
      const english = englishEntries.get(key) ?? '';
      return key.includes('keywords') ? false : placeholders(english) !== placeholders(value) || english.split('\n').length !== value.split('\n').length;
    });
    check(`${name}: every placeholder and line break matches en`, mismatched.length === 0, mismatched.map(([k]) => k));
  }

  console.log('\n== First /start shows the selector, nothing is saved yet ==');
  const newUser: User = { id: 101, language_code: 'en' };
  let at = await send(textUpdate(newUser, '/start'));
  const keyboard = lastKeyboard(at)?.flat() ?? [];
  check('selector has English, 中文, ไทย buttons', JSON.stringify(keyboard.map((b: any) => b.text)) === JSON.stringify(['English', '中文', 'ไทย']), keyboard);
  check('buttons carry lang:<code>:start', keyboard.map((b: any) => b.callback_data).join() === 'lang:en:start,lang:zh:start,lang:th:start');
  check('prompt is shown in all three languages', texts(at)[0] === 'Choose your language:\n请选择语言：\nโปรดเลือกภาษา:', texts(at));
  check('no help text before a choice', !texts(at).some((s) => s.includes('/search')));
  check('no row written for a user who has not chosen', db.upserts.length === 0);

  console.log('\n== Choosing Thai saves it and replies in Thai ==');
  at = await send(tapUpdate(newUser, 'lang:th:start'));
  check('one upsert with only telegramUserId + language', db.upserts.length === 1 &&
    JSON.stringify(db.upserts[0]) === JSON.stringify({
      where: { telegramUserId: '101' }, create: { telegramUserId: '101', language: 'th' },
      update: { language: 'th' }, select: { telegramUserId: true },
    }), db.upserts[0]);
  check('callback is answered', calls.slice(at).some((c) => c.method === 'answerCallbackQuery'));
  check('selector message edited to Thai confirmation', calls.slice(at).some((c) => c.method === 'editMessageText' && c.payload.text === th.language.saved));
  check('Thai help follows', texts(at).includes(th.help.private));
  at = await send(textUpdate(newUser, '/search stake'));
  check('next command replies in Thai without another DB read', texts(at)[0]?.startsWith("ผลการค้นหาสำหรับ 'stake'") && db.findUnique === 1, { text: texts(at)[0], reads: db.findUnique });

  console.log('\n== /language changes it ==');
  at = await send(textUpdate(newUser, '/language'));
  check('/language shows the three buttons (no follow-up action)', lastKeyboard(at)?.flat().map((b: any) => b.callback_data).join() === 'lang:en,lang:zh,lang:th');
  at = await send(tapUpdate(newUser, 'lang:zh'));
  check('saved as zh', settings.get('101') === 'zh' && db.upserts.length === 2);
  check('confirms in Chinese, then resends the keyboard', texts(at)[0] === zh.language.saved && texts(at)[1] === zh.keyboard.ready, texts(at));
  at = await send(textUpdate(newUser, '/help'));
  check('cache updated immediately: /help now Chinese', texts(at)[0] === zh.help.private && db.findUnique === 1);
  at = await send(textUpdate(newUser, '/language', 'supergroup'));
  check('/language in a group points to private chat, in Chinese', texts(at)[0] === zh.language.privateOnly &&
    lastKeyboard(at)?.[0]?.[0]?.url === 'https://t.me/offline_bot?start=language');

  console.log('\n== Returning user skips the selector ==');
  settings.set('202', 'zh');
  const returning: User = { id: 202, language_code: 'en' };
  at = await send(textUpdate(returning, '/start'));
  check('saved zh beats language_code en; help shown directly', texts(at).length === 1 && texts(at)[0] === zh.help.private && !lastKeyboard(at), texts(at));

  console.log('\n== Fallback to Telegram language_code, then English ==');
  const thaiPhone: User = { id: 303, language_code: 'th' };
  at = await send(textUpdate(thaiPhone, '/help'));
  check('language_code th -> Thai', texts(at)[0] === th.help.private);
  const zhHans: User = { id: 304, language_code: 'zh-hans' };
  at = await send(textUpdate(zhHans, '/help', 'supergroup'));
  check('group, language_code zh-hans -> Chinese group help', texts(at)[0] === zh.help.group);
  const german: User = { id: 305, language_code: 'de' };
  at = await send(textUpdate(german, '/help'));
  check('unsupported language_code de -> English', texts(at)[0] === en.help.private);
  at = await send(textUpdate(zhHans, '/start'));
  check('/start in private for a no-row zh user shows the selector', lastKeyboard(at)?.flat().length === 3);
  at = await send(textUpdate(zhHans, '/start', 'supergroup'));
  check('/start in a group never shows the selector', !lastKeyboard(at) && texts(at)[0] === zh.help.group);
  check('none of these users got a row', db.upserts.length === 2 && !settings.has('303') && !settings.has('304') && !settings.has('305'));

  console.log('\n== Casino content in the user language, English when missing or empty ==');
  at = await send(textUpdate(thaiPhone, '/search stake'));
  check('th: missing Thai name -> "Stake", missing Thai license -> "Curaçao"', texts(at)[0]?.includes('1. Stake\nคะแนน: 4.6/5\nใบอนุญาต: Curaçao') ?? false, texts(at)[0]);
  check('th: Thai site link', texts(at)[0]?.includes('https://www.bc.gs/th/casinos/stake') ?? false);
  at = await send(textUpdate(returning, '/search stake'));
  check('zh: Chinese name and license', texts(at)[0]?.includes('1. Stake 娱乐场\n评分：4.6/5\n牌照：库拉索') ?? false, texts(at)[0]);
  at = await send(textUpdate(returning, '/search roobet'));
  check('zh: empty Chinese name -> "Roobet"', texts(at)[0]?.includes('1. Roobet\n') ?? false, texts(at)[0]);
  at = await send(textUpdate(returning, '/review stake'));
  check('zh review: Chinese name, blank Chinese body -> English body', (texts(at)[0]?.startsWith('Stake 娱乐场\n综合评分：4.6/5') &&
    texts(at)[0]?.includes('编辑评测摘要：\nEnglish editorial review of Stake.')) ?? false, texts(at)[0]);
  at = await send(textUpdate(thaiPhone, '/review stake'));
  check('th review: Thai body used when present', texts(at)[0]?.includes('รีวิวภาษาไทยของ Stake') ?? false);
  at = await send(textUpdate(thaiPhone, '/rankings'));
  check('th rankings: Thai name where present, English otherwise', (texts(at)[0]?.includes('1. Stake (4.6/5)') &&
    texts(at)[0]?.includes('2. รูเบท (4.2/5)')) ?? false, texts(at)[0]);
  at = await send(textUpdate(thaiPhone, '/rankings crypto'));
  check('th category: missing Thai category name -> English', texts(at)[0]?.startsWith('คาสิโน 2 อันดับแรกใน Crypto Casinos:') ?? false, texts(at)[0]);
  at = await send(textUpdate(returning, '/rankings Crypto Casinos'));
  check('zh category: matched by English name, shown in Chinese', texts(at)[0]?.startsWith('加密货币娱乐场排名前 2 的娱乐场：') ?? false, texts(at)[0]);
  at = await send(textUpdate(returning, '/search stkae'));
  check('zh: typo still matches (matching unchanged)', texts(at)[0]?.includes('1. Stake 娱乐场') ?? false, texts(at)[0]);
  at = await send(textUpdate(returning, '/search zzzzqq'));
  check('zh: no match message in Chinese', texts(at)[0] === t('search.noResults', { query: 'zzzzqq' }, 'zh'));

  console.log('\n== Full complaint flow in Chinese, localized yes/no ==');
  const zhFlow: [string, (out: string[]) => boolean][] = [
    ['/complaint', (o) => o[0] === t('complaint.start', { label: '投诉' }, 'zh') && o[1] === zh.complaint.askCasino],
    ['stake', (o) => o[0] === '是关于 Stake 娱乐场 吗？是/否'],
    ['可能吧', (o) => o[0] === zh.complaint.yesNo],
    ['是', (o) => o[0] === zh.complaint.askSubject],
    ['提款 30 天仍未处理', (o) => o[0] === zh.complaint.describeIncident],
    ['9 月 1 日申请提款，至今未到账，客服没有回复。', (o) => o[0] === zh.complaint.askEvidence],
    ['跳过', (o) => o[0] === zh.complaint.askEmail],
    ['不是邮箱', (o) => o[0] === zh.complaint.invalidEmail],
    ['跳过', (o) => o[0]?.startsWith('请确认你的投诉：\n\n娱乐场：Stake 娱乐场\n主题：提款 30 天仍未处理') &&
      o[0].includes('电子邮箱：未提供') && o[1] === '确认发送此投诉吗？是/否'],
    ['是', (o) => /^谢谢。你的案件已提交，Case ID 为 BCGS-\d{4}-\d{5}，请妥善保存以备查询。$/.test(o[0] ?? '')],
  ];
  for (const [input, expect] of zhFlow) {
    at = await send(textUpdate(returning, input));
    const out = texts(at);
    check(`"${input}" -> ${JSON.stringify(out[0]?.slice(0, 40))}`, expect(out), out);
  }
  const saved = db.complaints.at(-1) ?? {};
  check('saved complaint unchanged in shape (listed casino, no name, no email, telegram source)',
    saved.casinoId === 'c-stake' && saved.casinoName === null && saved.contactEmail === null &&
    saved.telegramUserId === '202' && saved.source === 'telegram' && saved.type === 'complaint', saved);
  const admin = calls.filter((c) => c.method === 'sendMessage' && c.payload.chat_id === '-1009999').at(-1);
  check('admin notification stays English with the English casino name',
    /^New complaint — Case ID: BCGS-\d{4}-\d{5}\nCasino: Stake\nSubject: 提款 30 天仍未处理\nFrom: Tester$/.test(String(admin?.payload.text)), admin?.payload.text);

  console.log('\n== Chinese report: "否", English keywords, cancel, timeout ==');
  const reportFlow: [string, (out: string[]) => boolean][] = [
    ['/report', (o) => o[0] === t('complaint.start', { label: '举报' }, 'zh')],
    ['Unknown Casino XYZ', (o) => o[0] === t('complaint.casinoNotFound', { input: 'Unknown Casino XYZ' }, 'zh')],
    ['账户被冻结', (o) => o[0] === zh.complaint.describeIncident],
    ['赢钱后账户被冻结。', (o) => o[0] === zh.complaint.askEvidence],
    ['skip', (o) => o[0] === zh.complaint.askEmail],
    ['a@b.co', (o) => o[0]?.includes('娱乐场：Unknown Casino XYZ（不在我们的数据库中）') && o[1] === '确认发送此举报吗？是/否'],
    ['否', (o) => o[0] === zh.complaint.cancelled],
  ];
  const before = db.complaints.length;
  for (const [input, expect] of reportFlow) {
    at = await send(textUpdate(returning, input));
    check(`"${input}" -> ${JSON.stringify(texts(at)[0]?.slice(0, 40))}`, expect(texts(at)), texts(at));
  }
  check('"否" at confirm saved nothing', db.complaints.length === before);

  at = await send(textUpdate(returning, '/complaint'));
  at = await send(textUpdate(returning, 'roo'));
  check('single match "否" -> records typed name', texts(at)[0] === '是关于 Roobet 吗？是/否');
  at = await send(textUpdate(returning, '否'));
  check('localized no understood', texts(at)[0] === t('complaint.recordCasino', { input: 'roo' }, 'zh') && texts(at)[1] === zh.complaint.askSubject, texts(at));
  at = await send(textUpdate(returning, '/search x'));
  check('command mid-flow -> Chinese reminder', texts(at)[0] === t('complaint.middleOfFlow', { label: '投诉' }, 'zh'));
  at = await send(textUpdate(returning, '/cancel'));
  check('/cancel -> Chinese cancelled', texts(at)[0] === zh.complaint.cancelled);
  at = await send(textUpdate(returning, '/cancel'));
  check('/cancel with nothing active -> Chinese', texts(at)[0] === zh.complaint.nothingToCancel);

  at = await send(textUpdate(returning, '/complaint'));
  advanceMinutes(31);
  at = await send(textUpdate(returning, 'stake'));
  check('30-minute timeout -> Chinese expired message', texts(at)[0] === zh.complaint.expired, texts(at));

  console.log('\n== Thai keywords and group redirect ==');
  const thaiFlow: [string, (out: string[]) => boolean][] = [
    ['/complaint', (o) => o[1] === th.complaint.askCasino],
    ['stake', (o) => o[0] === 'เกี่ยวกับ Stake ใช่ไหม? ใช่/ไม่'],
    ['ใช่', (o) => o[0] === th.complaint.askSubject],
    ['/cancel', (o) => o[0] === th.complaint.cancelled],
  ];
  for (const [input, expect] of thaiFlow) {
    at = await send(textUpdate(thaiPhone, input));
    check(`th "${input}"`, expect(texts(at)), texts(at));
  }
  at = await send(textUpdate(returning, '/complaint', 'supergroup'));
  check('group /complaint -> Chinese privacy redirect with private-chat button',
    texts(at)[0] === '为保护隐私，请私信我提交投诉。' && lastKeyboard(at)?.[0]?.[0]?.text === '打开私聊', texts(at));
  const deepLinkUser: User = { id: 606, language_code: 'th' };
  at = await send(textUpdate(deepLinkUser, '/start report'));
  check('deep link from group, no saved language: selector first', lastKeyboard(at)?.flat()[2]?.callback_data === 'lang:th:report');
  at = await send(tapUpdate(deepLinkUser, 'lang:th:report'));
  check('after choosing, the report flow starts in Thai', texts(at).includes(t('complaint.start', { label: 'รายงาน' }, 'th')), texts(at));
  await send(textUpdate(deepLinkUser, '/cancel'));

  console.log('\n== English users are unchanged ==');
  settings.set('707', 'en');
  const english: User = { id: 707 };
  at = await send(textUpdate(english, '/complaint'));
  at = await send(textUpdate(english, 'stake'));
  check('English prompt and y/n still work', texts(at)[0] === 'Is this about Stake? yes/no');
  at = await send(textUpdate(english, 'y'));
  check('"y" accepted', texts(at)[0] === en.complaint.askSubject);
  await send(textUpdate(english, '/cancel'));

  console.log('\n== Command menus ==');
  at = calls.length;
  await setBotCommands(bot);
  const menuCalls = calls.slice(at).filter((c) => c.method === 'setMyCommands');
  check('default Menu Button set to commands', calls.slice(at).some((c) => c.method === 'setChatMenuButton' && c.payload.menu_button?.type === 'commands'));
  check('6 setMyCommands calls (3 languages x private/group)', menuCalls.length === 6);
  check('English lists have no language_code', menuCalls.filter((c) => !c.payload.language_code).length === 2);
  const zhPrivate = menuCalls.find((c) => c.payload.language_code === 'zh' && c.payload.scope.type === 'all_private_chats');
  check('zh private menu: English command names, Chinese descriptions',
    zhPrivate?.payload.commands.map((c: any) => c.command).join() === 'menu,start,help,search,review,rankings,links,complaint,report,language' &&
    zhPrivate?.payload.commands[3].description === zh.menu.search);
  check('th group menu present', menuCalls.some((c) => c.payload.language_code === 'th' && c.payload.scope.type === 'all_group_chats'));

  finish();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
