// Offline test for the private-chat reply keyboard, /menu and per-chat command menus.
// Prisma and Telegram are both stubbed, so nothing reaches the database or Telegram.
// Run with: node --import tsx scripts/test-keyboard.ts
import {
  advanceMinutes, calls, check, createOfflineBot, finish, lastKeyboard, replyKeyboards, settings, tapUpdate, texts, textUpdate,
  type User,
} from './offline-harness';

(async () => {
  const { send } = await createOfflineBot();
  const en = (await import('../src/i18n/en')).default;
  const zh = (await import('../src/i18n/zh')).default;
  const th = (await import('../src/i18n/th')).default;
  const { t, LOCALES } = await import('../src/i18n');
  const { MAIN_KEYBOARD_LAYOUT } = await import('../src/config/main-keyboard');
  const { menuActionFor } = await import('../src/keyboard');

  const chatMenuCalls = (from = 0) =>
    calls.slice(from).filter((c) => c.method === 'setMyCommands' && c.payload.scope?.type === 'chat');
  const labels = (markup: any) => markup?.keyboard?.map((row: any[]) => row.map((b) => b.text));
  /** Runs `input` and returns what the user saw. */
  const run = async (user: User, input: string, chatType = 'private') => texts(await send(textUpdate(user, input, chatType)));

  console.log('\n== Layout comes from the config ==');
  const englishRows = [['🔍 Search', '⭐ Reviews', '🏆 Rankings'], ['📝 Complaint', '🚨 Report'], ['🔗 Links', '🌐 Language', '❓ Help']];
  check('config has 3 rows of 3/2/3 buttons', MAIN_KEYBOARD_LAYOUT.map((row) => row.length).join() === '3,2,3');
  const allLabels = LOCALES.flatMap((locale) =>
    MAIN_KEYBOARD_LAYOUT.flat().map((b) => `${b.emoji} ${t(`keyboard.${b.action}`, {}, locale)}`));
  check('every label in every language is unique', new Set(allLabels).size === allLabels.length, allLabels);
  check('every label maps back to its action', LOCALES.every((locale) =>
    MAIN_KEYBOARD_LAYOUT.flat().every((b) => menuActionFor(`${b.emoji} ${t(`keyboard.${b.action}`, {}, locale)}`) === b.action)));

  console.log('\n== New user: keyboard only after choosing a language ==');
  const newUser: User = { id: 1001, language_code: 'en' };
  let at = await send(textUpdate(newUser, '/start'));
  check('/start shows the language selector, no bottom keyboard yet', lastKeyboard(at)?.flat().length === 3 && replyKeyboards(at).length === 0);
  at = await send(tapUpdate(newUser, 'lang:en:start'));
  const firstKeyboard = replyKeyboards(at)[0];
  check('after choosing: help text carries the keyboard', texts(at)[1] === en.help.private && replyKeyboards(at).length === 1);
  check('rows and English labels match the layout', JSON.stringify(labels(firstKeyboard)) === JSON.stringify(englishRows), labels(firstKeyboard));
  check('persistent, resized, not one-time', firstKeyboard?.is_persistent === true && firstKeyboard?.resize_keyboard === true && !firstKeyboard?.one_time_keyboard, firstKeyboard);
  const chosenMenu = chatMenuCalls(at);
  check('chat command menu set once, scoped to this chat, in English, /menu first',
    chosenMenu.length === 1 && chosenMenu[0].payload.scope.chat_id === 1001 && !chosenMenu[0].payload.language_code &&
    chosenMenu[0].payload.commands[0].command === 'menu' && chosenMenu[0].payload.commands[0].description === en.menu.menu, chosenMenu);

  console.log('\n== /menu and /start in private show it; returning user menu synced once ==');
  settings.set('1002', 'th');
  const thai: User = { id: 1002, language_code: 'en' };
  at = await send(textUpdate(thai, '/menu'));
  check('/menu replies with the Thai keyboard', texts(at)[0] === th.keyboard.ready &&
    labels(replyKeyboards(at)[0])?.[0]?.join() === '🔍 ค้นหา,⭐ รีวิว,🏆 อันดับ', labels(replyKeyboards(at)[0]));
  check('first /menu sets the Thai chat command menu', chatMenuCalls(at).length === 1 &&
    chatMenuCalls(at)[0].payload.scope.chat_id === 1002 && chatMenuCalls(at)[0].payload.commands[0].description === th.menu.menu);
  at = await send(textUpdate(thai, '/menu'));
  check('second /menu: keyboard again, no repeat setMyCommands', replyKeyboards(at).length === 1 && chatMenuCalls(at).length === 0);
  at = await send(textUpdate(thai, '/start'));
  check('/start for a returning user: Thai help with keyboard, no repeat setMyCommands',
    texts(at)[0] === th.help.private && replyKeyboards(at).length === 1 && chatMenuCalls(at).length === 0 && !lastKeyboard(at));
  at = await send(textUpdate(thai, '/search stake'));
  check('ordinary messages never call setMyCommands', chatMenuCalls(at).length === 0);

  console.log('\n== Never in groups ==');
  const groupUser: User = { id: 1003, language_code: 'zh' };
  const groupStart = calls.length;
  await send(textUpdate(groupUser, '/start', 'supergroup'));
  await send(textUpdate(groupUser, '/help', 'supergroup'));
  at = await send(textUpdate(groupUser, '/menu', 'supergroup'));
  check('/menu in a group replies with the group help, no keyboard', texts(at)[0] === zh.help.group);
  at = await send(textUpdate(groupUser, '🏆 排名', 'supergroup'));
  check('a button label typed in a group does nothing', texts(at).length === 0);
  check('no reply keyboard and no keyboard removal sent to the group',
    calls.slice(groupStart).every((c) => !c.payload.reply_markup?.keyboard && !c.payload.reply_markup?.remove_keyboard));
  check('no chat-scoped command menu for groups', chatMenuCalls(groupStart).length === 0);

  console.log('\n== Each button runs the same handler as its command ==');
  const user: User = { id: 1004 };
  settings.set('1004', 'en');
  const same = async (button: string, command: string) => {
    const viaCommand = await run(user, command);
    const viaButton = await run(user, button);
    check(`${button} == ${command}`, JSON.stringify(viaButton) === JSON.stringify(viaCommand) && viaButton.length > 0, { viaButton, viaCommand });
  };
  await same('🏆 Rankings', '/rankings');
  await same('🔗 Links', '/links');
  await same('❓ Help', '/help');
  at = await send(textUpdate(user, '🌐 Language'));
  check('🌐 Language shows the selector', lastKeyboard(at)?.flat().map((b: any) => b.callback_data).join() === 'lang:en,lang:zh,lang:th');
  check('📝 Complaint starts the complaint flow', (await run(user, '📝 Complaint'))[0] === t('complaint.start', { label: 'complaint' }, 'en'));
  await run(user, '/cancel');
  check('🚨 Report starts the report flow', (await run(user, '🚨 Report'))[0] === t('complaint.start', { label: 'report' }, 'en'));
  await run(user, '/cancel');

  console.log('\n== Search / Reviews: prompt, then act on the next message ==');
  check('🔍 Search asks for a name', (await run(user, '🔍 Search'))[0] === en.keyboard.askSearch);
  const searched = await run(user, 'stake');
  check('next message runs the search', JSON.stringify(searched) === JSON.stringify(await run(user, '/search stake')), searched);
  check('pending is consumed: a further message gets no reply', (await run(user, 'stake')).length === 0);
  check('⭐ Reviews asks for a name', (await run(user, '⭐ Reviews'))[0] === en.keyboard.askReview);
  const reviewed = await run(user, 'stake');
  check('next message runs the review', JSON.stringify(reviewed) === JSON.stringify(await run(user, '/review stake')), reviewed);

  await run(user, '🔍 Search');
  check('a command instead runs the command', (await run(user, '/help'))[0] === en.help.private);
  check('...and drops the pending search', (await run(user, 'stake')).length === 0);
  await run(user, '🔍 Search');
  check('another button instead runs that button', (await run(user, '🔗 Links'))[0]?.startsWith('🔗 BC.GS Links') ?? false);
  check('...and drops the pending search', (await run(user, 'stake')).length === 0);
  await run(user, '⭐ Reviews');
  advanceMinutes(6);
  check('pending expires after 5 minutes', (await run(user, 'stake')).length === 0);
  check('plain text with nothing pending still gets no reply', (await run(user, 'hello')).length === 0);

  console.log('\n== Labels recognized in every language ==');
  check('Thai Rankings label, English user -> English rankings', (await run(user, '🏆 อันดับ'))[0]?.startsWith('Top 2 casinos overall:') ?? false);
  check('Chinese Reviews label, English user -> English prompt', (await run(user, '⭐ 评测'))[0] === en.keyboard.askReview);
  check('...and the review still runs', (await run(user, 'stake'))[0]?.startsWith('Stake\nOverall rating: 4.6/5') ?? false);
  check('English Help label, Thai user -> Thai help', (await run(thai, '❓ Help'))[0] === th.help.private);

  console.log('\n== A button tapped mid-complaint is not an answer ==');
  const zhUser: User = { id: 1005 };
  settings.set('1005', 'zh');
  const middle = t('complaint.middleOfFlow', { label: '投诉' }, 'zh');
  await run(zhUser, '/complaint');
  check('at the casino question: 🔍 搜索 -> "in the middle" reply', JSON.stringify(await run(zhUser, '🔍 搜索')) === JSON.stringify([middle]));
  check('English label too', JSON.stringify(await run(zhUser, '🏆 Rankings')) === JSON.stringify([middle]));
  check('flow untouched: the casino question still takes the real answer', (await run(zhUser, 'stake'))[0] === '是关于 Stake 娱乐场 吗？是/否');
  check('at a yes/no question: button is not yes/no', JSON.stringify(await run(zhUser, '📝 投诉')) === JSON.stringify([middle]));
  check('yes still works afterwards', (await run(zhUser, '是'))[0] === zh.complaint.askSubject);
  await run(zhUser, '提款 30 天仍未处理');
  check('details step: button rejected', JSON.stringify(await run(zhUser, '🌐 语言')) === JSON.stringify([middle]));
  check('details step continues', (await run(zhUser, '提款一直未到账。'))[0] === zh.complaint.askEvidence);
  check('evidence step: button rejected, not "skip"', JSON.stringify(await run(zhUser, '❓ 帮助')) === JSON.stringify([middle]));
  check('evidence step: 跳过 still continues', (await run(zhUser, '跳过'))[0] === zh.complaint.askEmail);
  check('/cancel still ends the flow', (await run(zhUser, '/cancel'))[0] === zh.complaint.cancelled);
  check('after the flow, the same button works again', (await run(zhUser, '🔍 搜索'))[0] === zh.keyboard.askSearch);
  await run(zhUser, '/help');

  console.log('\n== /language resends the keyboard and switches the chat command menu ==');
  at = await send(textUpdate(user, '/language'));
  at = await send(tapUpdate(user, 'lang:zh'));
  check('keyboard resent with Chinese labels', texts(at)[1] === zh.keyboard.ready &&
    labels(replyKeyboards(at)[0])?.[2]?.join() === '🔗 链接,🌐 语言,❓ 帮助', labels(replyKeyboards(at)[0]));
  check('chat command menu switched to Chinese, once', chatMenuCalls(at).length === 1 &&
    chatMenuCalls(at)[0].payload.scope.chat_id === 1004 && chatMenuCalls(at)[0].payload.commands[0].description === zh.menu.menu);
  at = await send(textUpdate(user, '/menu'));
  check('a later /menu does not repeat it', chatMenuCalls(at).length === 0);
  check('old English label still works after the switch, replying in Chinese', (await run(user, '🔍 Search'))[0] === zh.keyboard.askSearch);

  console.log('\n== Startup ==');
  const { setBotCommands } = await import('../src/command-menu');
  const { bot } = await createOfflineBot();
  at = calls.length;
  await setBotCommands(bot);
  check('default Menu Button explicitly set to commands', calls.slice(at).filter((c) => c.method === 'setChatMenuButton').length === 1 &&
    calls.slice(at).find((c) => c.method === 'setChatMenuButton')?.payload.menu_button?.type === 'commands');
  const privateMenus = calls.slice(at).filter((c) => c.method === 'setMyCommands' && c.payload.scope.type === 'all_private_chats');
  check('/menu first in every private list (en default, zh, th)', privateMenus.length === 3 &&
    privateMenus.every((c) => c.payload.commands[0].command === 'menu'));
  check('localized /menu descriptions', privateMenus.map((c) => c.payload.commands[0].description).sort().join('|') ===
    [en.menu.menu, zh.menu.menu, th.menu.menu].sort().join('|'));

  finish();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
