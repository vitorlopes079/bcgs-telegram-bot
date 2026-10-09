// Offline test for the admin-edited /start welcome (SiteSetting telegram_welcome_<locale>).
// Prisma and Telegram are both stubbed, so nothing reaches the database or Telegram.
// Run with: node --import tsx scripts/test-welcome.ts
import {
  advanceMinutes, calls, check, createOfflineBot, db, failingMethods, finish, settings, siteSettings, tapUpdate, texts,
  textUpdate, type Call, type User,
} from './offline-harness';

(async () => {
  const { send } = await createOfflineBot();
  const en = (await import('../src/i18n/en')).default;
  const zh = (await import('../src/i18n/zh')).default;
  const th = (await import('../src/i18n/th')).default;
  const { t } = await import('../src/i18n');
  const { parseWelcome } = await import('../src/services/welcome');
  const { prisma } = await import('../src/prisma');

  const SENDS = ['sendMessage', 'sendPhoto', 'sendAnimation', 'sendVideo'];
  /** Messages sent to the user since `from`, in order. */
  const sent = (from: number): Call[] => calls.slice(from).filter((c) => SENDS.includes(c.method));
  const inline = (c: Call | undefined) => c?.payload.reply_markup?.inline_keyboard as { text: string; url: string }[][] | undefined;
  const hasReplyKeyboard = (c: Call | undefined) => Boolean(c?.payload.reply_markup?.keyboard);
  const MEDIA = 'https://proj.supabase.co/storage/v1/object/public/telegram-media/welcome/en-abc123def456.mp4';
  const PHOTO = MEDIA.replace('.mp4', '.jpg');
  const GIF = MEDIA.replace('.mp4', '.gif');
  const button = (n: number) => ({ label: `Button ${n}`, url: `https://t.me/bcgs${n}` });

  /** Stores the welcome for `locale` (raw string, or an object to JSON-encode) and expires the cache. */
  const setWelcome = (locale: string, value: unknown) => {
    if (value === undefined) siteSettings.delete(`telegram_welcome_${locale}`);
    else siteSettings.set(`telegram_welcome_${locale}`, typeof value === 'string' ? value : JSON.stringify(value));
    advanceMinutes(6);
  };
  const clearAll = () => ['en', 'zh', 'th'].forEach((locale) => setWelcome(locale, undefined));
  const welcome = (fields: Record<string, unknown>) => ({ text: '', caption: '', mediaUrl: null, mediaType: null, buttons: [], ...fields });

  settings.set('2001', 'en');
  settings.set('2002', 'zh');
  settings.set('2003', 'th');
  const enUser: User = { id: 2001, language_code: 'en' };
  const zhUser: User = { id: 2002, language_code: 'en' };
  const thUser: User = { id: 2003, language_code: 'en' };
  const start = (user: User) => send(textUpdate(user, '/start'));

  console.log('\n== Nothing set: built-in welcome unchanged ==');
  clearAll();
  let at = await start(enUser);
  let out = sent(at);
  check('one message: English help with the bottom keyboard, no inline buttons',
    out.length === 1 && out[0].payload.text === en.help.private && hasReplyKeyboard(out[0]) && !inline(out[0]), out);
  at = await start(zhUser);
  check('Chinese user gets the Chinese built-in help', sent(at).length === 1 && sent(at)[0].payload.text === zh.help.private);

  console.log('\n== Text only ==');
  setWelcome('en', welcome({ text: 'Hello from the admin panel!' }));
  at = await start(enUser);
  out = sent(at);
  check('zero buttons: one message, bottom keyboard rides on it, no follow-up',
    out.length === 1 && out[0].payload.text === 'Hello from the admin panel!' && hasReplyKeyboard(out[0]), out);
  check('plain text: no parse_mode', out.every((c) => c.payload.parse_mode === undefined));

  setWelcome('en', welcome({ text: 'Hi', buttons: [button(1)] }));
  out = sent(await start(enUser));
  check('one button: welcome with one URL button, then follow-up with the bottom keyboard',
    out.length === 2 && JSON.stringify(inline(out[0])) === JSON.stringify([[{ text: 'Button 1', url: 'https://t.me/bcgs1' }]]) &&
    !hasReplyKeyboard(out[0]) && out[1].payload.text === en.keyboard.ready && hasReplyKeyboard(out[1]) && !inline(out[1]), out);

  setWelcome('en', welcome({ text: 'Hi', buttons: [button(1), button(2), button(3)] }));
  out = sent(await start(enUser));
  check('three buttons: one per row, in order', JSON.stringify(inline(out[0])?.map((row) => row.map((b) => b.text))) ===
    JSON.stringify([['Button 1'], ['Button 2'], ['Button 3']]), inline(out[0]));

  console.log('\n== Each media type with a short text ==');
  for (const [url, method] of [[PHOTO, 'sendPhoto'], [GIF, 'sendAnimation'], [MEDIA, 'sendVideo']] as const) {
    const type = method === 'sendPhoto' ? 'photo' : method === 'sendAnimation' ? 'animation' : 'video';
    setWelcome('en', welcome({ text: 'Short welcome', mediaUrl: url, mediaType: type, buttons: [button(1)] }));
    out = sent(await start(enUser));
    const field = type;
    check(`${type}: one ${method} with the text as caption and the buttons, then the follow-up`,
      out.length === 2 && out[0].method === method && out[0].payload[field] === url && out[0].payload.caption === 'Short welcome' &&
      inline(out[0])?.length === 1 && out[1].payload.text === en.keyboard.ready && hasReplyKeyboard(out[1]), out);
  }

  setWelcome('en', welcome({ text: 'Main text', caption: 'Caption wins', mediaUrl: PHOTO, mediaType: 'photo' }));
  out = sent(await start(enUser));
  check('caption set: media uses the caption; zero buttons so the keyboard rides on it',
    out.length === 1 && out[0].method === 'sendPhoto' && out[0].payload.caption === 'Caption wins' && hasReplyKeyboard(out[0]), out);

  setWelcome('en', welcome({ text: 'x'.repeat(1024), mediaUrl: PHOTO, mediaType: 'photo', buttons: [button(1)] }));
  out = sent(await start(enUser));
  check('text of exactly 1024: still one media message', out[0].method === 'sendPhoto' && out[0].payload.caption.length === 1024 && out.length === 2);

  const long = `Start. ${'Long welcome text. '.repeat(100)}End.`;
  setWelcome('en', welcome({ text: long, mediaUrl: MEDIA, mediaType: 'video', buttons: [button(1), button(2)] }));
  out = sent(await start(enUser));
  check('text over 1024, no caption: media alone (no caption, no keyboard)',
    out[0]?.method === 'sendVideo' && out[0].payload.caption === undefined && out[0].payload.reply_markup === undefined, out[0]);
  check('...then the full text, uncut, with the buttons', out[1]?.payload.text === long && long.length > 1024 && inline(out[1])?.length === 2);
  check('...then the follow-up with the bottom keyboard', out.length === 3 && out[2].payload.text === en.keyboard.ready && hasReplyKeyboard(out[2]));

  setWelcome('en', welcome({ text: long, mediaUrl: MEDIA, mediaType: 'video' }));
  out = sent(await start(enUser));
  check('long text, zero buttons: media alone, then text with the bottom keyboard, no follow-up',
    out.length === 2 && out[0].payload.reply_markup === undefined && out[1].payload.text === long && hasReplyKeyboard(out[1]), out);

  setWelcome('en', welcome({ mediaUrl: PHOTO, mediaType: 'photo' }));
  out = sent(await start(enUser));
  check('media only: photo without caption, keyboard on it', out.length === 1 && out[0].method === 'sendPhoto' &&
    out[0].payload.caption === undefined && hasReplyKeyboard(out[0]), out);

  console.log('\n== Media send fails ==');
  const warnings: string[] = [];
  const realWarn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.join(' ')); };
  failingMethods.add('sendPhoto');
  setWelcome('en', welcome({ text: 'Fallback text', mediaUrl: PHOTO, mediaType: 'photo', buttons: [button(1)] }));
  out = sent(await start(enUser));
  check('photo rejected: text with the buttons instead, then the follow-up',
    out.length === 3 && out[0].method === 'sendPhoto' && out[1].payload.text === 'Fallback text' && inline(out[1])?.length === 1 &&
    out[2].payload.text === en.keyboard.ready, out.map((c) => c.method));
  check('a short warning was logged, without the URL', warnings.length === 1 && warnings[0].includes('photo') &&
    warnings[0].includes('400') && !warnings[0].includes('supabase') && !warnings[0].includes('http'), warnings);

  setWelcome('en', welcome({ mediaUrl: PHOTO, mediaType: 'photo', buttons: [button(1)] }));
  out = sent(await start(enUser));
  check('media-only welcome rejected: built-in welcome instead', out.at(-1)?.payload.text === en.help.private &&
    hasReplyKeyboard(out.at(-1)) && !out.some((c) => c.payload.text === en.keyboard.ready), out.map((c) => c.method));
  failingMethods.clear();
  console.warn = realWarn;

  console.log('\n== Invalid values ==');
  const parse = (value: unknown) => parseWelcome(typeof value === 'string' ? value : JSON.stringify(value));
  for (const [name, value] of [
    ['empty string', ''], ['spaces', '   '], ['invalid JSON', '{"text": "hi"'], ['JSON array', '[1,2]'], ['JSON string', '"hello"'],
    ['null', 'null'], ['no text or media', { caption: 'only caption', buttons: [button(1)] }], ['text over 4096', { text: 'x'.repeat(4097) }],
  ] as const) {
    check(`${name} → not set`, parse(value) === null, parse(value));
  }
  const dirty = parse({
    text: '  Hi  ', caption: 'c'.repeat(1025), mediaUrl: 'http://insecure.example/x.jpg', mediaType: 'photo', extra: 'ignored',
    buttons: [
      { label: 'x'.repeat(31), url: 'https://a.com' }, { label: 'Http', url: 'http://a.com' }, { label: 'Tg', url: 'tg://resolve?domain=x' },
      { label: '', url: 'https://a.com' }, 'not an object', null, { label: 'Good 1', url: 'https://good.com/1' },
      { label: 'Good 2', url: 'https://t.me/x' }, { label: 'Good 3', url: 'https://good.com/3' }, { label: 'Good 4', url: 'https://good.com/4' },
    ],
  });
  check('invalid fields dropped, valid ones kept, text trimmed', JSON.stringify(dirty) === JSON.stringify({
    text: 'Hi', caption: '', media: null,
    buttons: [{ label: 'Good 1', url: 'https://good.com/1' }, { label: 'Good 2', url: 'https://t.me/x' }, { label: 'Good 3', url: 'https://good.com/3' }],
  }), dirty);
  check('unknown mediaType drops the media', parse({ text: 'Hi', mediaUrl: PHOTO, mediaType: 'gif' })?.media === null);
  check('non-string text dropped', parse({ text: 42, mediaUrl: PHOTO, mediaType: 'photo' })?.text === '');

  setWelcome('en', '{not json');
  out = sent(await start(enUser));
  check('invalid JSON in the database: built-in welcome', out.length === 1 && out[0].payload.text === en.help.private);

  console.log('\n== Language fallback ==');
  setWelcome('en', welcome({ text: 'English welcome' }));
  setWelcome('th', welcome({ text: 'ยินดีต้อนรับ' }));
  out = sent(await start(zhUser));
  check('Chinese not set: English welcome', out[0]?.payload.text === 'English welcome', out);
  out = sent(await start(thUser));
  check('Thai set: Thai welcome', out[0]?.payload.text === 'ยินดีต้อนรับ', out);
  setWelcome('zh', '[]');
  out = sent(await start(zhUser));
  check('Chinese invalid: English welcome', out[0]?.payload.text === 'English welcome');
  setWelcome('en', undefined);
  out = sent(await start(zhUser));
  check('Chinese and English not set: Chinese built-in welcome', out.length === 1 && out[0].payload.text === zh.help.private);

  console.log('\n== Cache ==');
  clearAll();
  setWelcome('en', welcome({ text: 'Cached v1' }));
  const queriesBefore = db.siteSettingQueries;
  await start(enUser);
  await start(zhUser);
  await start(thUser);
  await start(enUser);
  check('four /starts in three languages: one query for all three keys', db.siteSettingQueries - queriesBefore === 1,
    db.siteSettingQueries - queriesBefore);
  siteSettings.set('telegram_welcome_en', JSON.stringify(welcome({ text: 'Cached v2' })));
  advanceMinutes(4);
  out = sent(await start(enUser));
  check('within 5 minutes: still the cached copy, no new query', out[0]?.payload.text === 'Cached v1' && db.siteSettingQueries - queriesBefore === 1);
  advanceMinutes(2);
  out = sent(await start(enUser));
  check('after 5 minutes: reloaded once, new copy', out[0]?.payload.text === 'Cached v2' && db.siteSettingQueries - queriesBefore === 2);

  const realSiteSetting = (prisma as any).siteSetting;
  Object.defineProperty(prisma, 'siteSetting', {
    value: { findMany: async () => { throw new Error('database down'); } }, configurable: true,
  });
  console.warn = () => {};
  advanceMinutes(6);
  out = sent(await start(enUser));
  check('database down with a stale copy: stale welcome still sent', out[0]?.payload.text === 'Cached v2', out);
  console.warn = realWarn;
  Object.defineProperty(prisma, 'siteSetting', { value: realSiteSetting, configurable: true });

  console.log('\n== First-time language pick, then the welcome ==');
  setWelcome('zh', welcome({ text: '欢迎！', buttons: [button(1)] }));
  const newUser: User = { id: 2100, language_code: 'zh' };
  at = await start(newUser);
  check('new user /start: language selector, no welcome yet', sent(at).length === 1 && !sent(at).some((c) => c.payload.text === '欢迎！'));
  at = await send(tapUpdate(newUser, 'lang:zh:start'));
  out = sent(at);
  check('after picking Chinese: confirmation edit, then the Chinese welcome, then the keyboard',
    texts(at)[0] === zh.language.saved && out[0]?.payload.text === '欢迎！' && inline(out[0])?.length === 1 &&
    out[1]?.payload.text === zh.keyboard.ready && hasReplyKeyboard(out[1]) && out.length === 2, texts(at));
  check('chat command menu still synced once', calls.slice(at).filter((c) => c.method === 'setMyCommands').length === 1);

  const otherNew: User = { id: 2101, language_code: 'en' };
  await start(otherNew);
  at = await send(tapUpdate(otherNew, 'lang:th:start'));
  setWelcome('th', undefined);
  setWelcome('en', undefined);
  const thaiNew: User = { id: 2102, language_code: 'en' };
  await start(thaiNew);
  at = await send(tapUpdate(thaiNew, 'lang:th:start'));
  check('nothing set: first pick shows the built-in Thai help with the keyboard, as before',
    texts(at)[0] === th.language.saved && texts(at)[1] === th.help.private && sent(at).length === 1 && hasReplyKeyboard(sent(at)[0]), texts(at));

  console.log('\n== Unchanged: /start parameters, /menu, groups ==');
  setWelcome('en', welcome({ text: 'Custom EN', mediaUrl: PHOTO, mediaType: 'photo', buttons: [button(1)] }));
  const noWelcome = (from: number) => !sent(from).some((c) => c.method === 'sendPhoto' || c.payload.text === 'Custom EN' || c.payload.caption === 'Custom EN');
  at = await send(textUpdate(enUser, '/start complaint'));
  check('/start complaint: complaint flow, no welcome', texts(at)[0] === t('complaint.start', { label: 'complaint' }, 'en') && noWelcome(at), texts(at));
  await send(textUpdate(enUser, '/cancel'));
  at = await send(textUpdate(enUser, '/start report'));
  check('/start report: report flow, no welcome', texts(at)[0]?.startsWith(t('complaint.start', { label: t('complaint.typeReport', {}, 'en') }, 'en')) && noWelcome(at), texts(at));
  await send(textUpdate(enUser, '/cancel'));
  at = await send(textUpdate(enUser, '/start complaint_stake'));
  check('/start complaint_<slug>: preselected complaint, no welcome', texts(at)[0]?.includes('Stake') && noWelcome(at), texts(at));
  await send(textUpdate(enUser, '/cancel'));
  at = await send(textUpdate(enUser, '/start language'));
  check('/start language: language selector, no welcome', texts(at)[0] === ['en', 'zh', 'th'].map((l) => t('language.choose', {}, l as 'en')).join('\n') && noWelcome(at));
  at = await send(textUpdate(enUser, '/menu'));
  check('/menu: unchanged keyboard message, no welcome', sent(at).length === 1 && texts(at)[0] === en.keyboard.ready && hasReplyKeyboard(sent(at)[0]) && noWelcome(at));
  at = await send(textUpdate(enUser, '/help'));
  check('/help: unchanged', texts(at)[0] === en.help.private && noWelcome(at));
  at = await send(tapUpdate(enUser, 'lang:en'));
  check('language selector change (no start): keyboard.ready as before, no welcome', texts(at).includes(en.keyboard.ready) && noWelcome(at), texts(at));

  const groupUser: User = { id: 2200, language_code: 'en' };
  at = await send(textUpdate(groupUser, '/start', 'supergroup'));
  check('group /start: group help only, no welcome, no keyboard', sent(at).length === 1 && texts(at)[0] === en.help.group &&
    !hasReplyKeyboard(sent(at)[0]) && noWelcome(at), texts(at));

  finish();
})();
