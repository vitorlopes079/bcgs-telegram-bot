// Offline test: inline buttons in the complaint and report flows. Prisma and Telegram are both stubbed.
// Run with: node --import tsx scripts/test-flow-buttons.ts
import type { Update } from 'grammy/types';
import {
  advanceMinutes, calls, check, createOfflineBot, db, finish, settings, tapUpdate, texts, textUpdate, type Call, type User,
} from './offline-harness';

(async () => {
  const { send } = await createOfflineBot();
  const en = (await import('../src/i18n/en')).default;
  const zh = (await import('../src/i18n/zh')).default;
  const th = (await import('../src/i18n/th')).default;
  const { t } = await import('../src/i18n');
  const { decodeFlowButton } = await import('../src/callback-data');

  /** The flow buttons of the last message sent since `from`, as rows of [label, data]. */
  const flowRows = (from: number): [string, string][][] => {
    const markup = calls.slice(from).reverse()
      .find((c: Call) => c.method === 'sendMessage' && c.payload.reply_markup?.inline_keyboard)?.payload.reply_markup.inline_keyboard ?? [];
    return markup.map((row: any[]) => row.map((b) => [b.text, b.callback_data]));
  };
  const dataFor = (from: number, answer: string) =>
    flowRows(from).flat().find(([, data]) => decodeFlowButton(data)?.answer === answer)?.[1] ?? 'missing';
  const since = (from: number, method: string) => calls.slice(from).filter((c) => c.method === method);
  const cleared = (from: number) => since(from, 'editMessageReplyMarkup').filter((c) => c.payload.reply_markup?.inline_keyboard?.length === 0).length;

  let taps = 0;
  const unanswered: string[] = [];
  const tap = async (user: User, data: string, update?: Update) => {
    taps += 1;
    const from = await send(update ?? tapUpdate(user, data));
    if (since(from, 'answerCallbackQuery').length !== 1) unanswered.push(data);
    return from;
  };
  const type = (user: User, text: string) => send(textUpdate(user, text));
  const rows = () => db.complaints.length;
  const cancelled = (from: number) => texts(from).at(-1) === en.complaint.cancelled;

  const user: User = { id: 6001 };
  settings.set('6001', 'en');

  console.log('\n== Full complaint, buttons wherever there are buttons ==');
  let before = rows();
  let at = await type(user, '/complaint');
  check('casino question has only Cancel', JSON.stringify(flowRows(at).map((r) => r.map(([label]) => label))) === JSON.stringify([['✖️ Cancel']]));
  at = await type(user, 'stake');
  check('one match: Yes / No on one row, Cancel below', JSON.stringify(flowRows(at).map((r) => r.map(([label]) => label))) ===
    JSON.stringify([['✅ Yes', '❌ No'], ['✖️ Cancel']]));
  check('typed casino name removes the Cancel button of the question', cleared(at) === 1);
  at = await tap(user, dataFor(at, 'y'));
  check('Yes -> subject, with Cancel', texts(at)[0] === en.complaint.askSubject && flowRows(at)[0]?.[0]?.[0] === '✖️ Cancel');
  check('the tapped Yes/No buttons are removed', cleared(at) >= 1);
  at = await type(user, 'Withdrawal stuck');
  check('details question with Cancel', texts(at)[0] === en.complaint.describeIncident && flowRows(at)[0]?.[0]?.[0] === '✖️ Cancel');
  at = await type(user, 'Asked on Sept 1, nothing since.');
  check('evidence: Done + Skip, then Cancel', JSON.stringify(flowRows(at).map((r) => r.map(([label]) => label))) ===
    JSON.stringify([['✅ Done', '⏭️ Skip'], ['✖️ Cancel']]));
  at = await tap(user, dataFor(at, 'd'));
  check('Done -> email: Skip + Cancel', texts(at)[0] === en.complaint.askEmail &&
    JSON.stringify(flowRows(at).map((r) => r.map(([label]) => label))) === JSON.stringify([['⏭️ Skip', '✖️ Cancel']]));
  at = await tap(user, dataFor(at, 's'));
  check('Skip -> summary then Confirm + Cancel', texts(at)[0]?.startsWith(t('complaint.summaryTitle', { label: 'complaint' }, 'en')) &&
    texts(at)[1] === t('complaint.confirmSubmission', { label: 'complaint' }, 'en') &&
    JSON.stringify(flowRows(at).map((r) => r.map(([label]) => label))) === JSON.stringify([['✅ Confirm', '✖️ Cancel']]), texts(at));
  check('summary still shows the casino', texts(at)[0]?.includes(t('complaint.summaryCasino', { casinoLine: 'Stake' }, 'en')) ?? false);
  const confirmData = dataFor(at, 'ok');
  at = await tap(user, confirmData);
  check('Confirm -> submitted, one row with casinoId', /BCGS-\d{4}-\d{5}/.test(texts(at)[0] ?? '') && rows() === before + 1 &&
    db.complaints.at(-1)?.casinoId === 'c-stake' && db.complaints.at(-1)?.type === 'complaint');
  const completedConfirm = confirmData;

  console.log('\n== Stale buttons after completion ==');
  before = rows();
  at = await tap(user, completedConfirm);
  check('old Confirm: "submission has ended" popup, buttons removed, nothing saved or sent',
    since(at, 'answerCallbackQuery')[0]?.payload.text === en.complaint.flowEnded && cleared(at) === 1 && rows() === before && texts(at).length === 0);

  console.log('\n== Full report with the casino list and buttons ==');
  before = rows();
  await type(user, '/report');
  at = await type(user, 'casino');
  const listRows = flowRows(at);
  check('several matches: one button per casino, then None of these', JSON.stringify(listRows.map((r) => r.map(([label]) => label))) ===
    JSON.stringify([['Alpha Casino'], ['Bravo Casino'], ['Charlie Casino'], ['Delta Casino'], ['Echo Casino'], ['🚫 None of these'], ['✖️ Cancel']]));
  at = await tap(user, dataFor(at, 'p2'));
  check('casino 2 -> straight to subject', texts(at)[0] === en.complaint.askSubject);
  await type(user, 'Account frozen');
  at = await type(user, 'Frozen after a win.');
  at = await tap(user, dataFor(at, 's'));
  at = await tap(user, dataFor(at, 's'));
  at = await tap(user, dataFor(at, 'ok'));
  const report = db.complaints.at(-1);
  check('report saved once: Bravo, scam_report', rows() === before + 1 && report?.casinoId === 'c-bravo' && report?.type === 'scam_report', report);

  console.log('\n== Typed only (unchanged) ==');
  before = rows();
  for (const input of ['/complaint', 'stake', 'yes', 'Subject', 'Details.', 'skip']) await type(user, input);
  at = await type(user, 'me@example.com');
  at = await type(user, 'yes');
  check('typed flow saves one row with the email', rows() === before + 1 && db.complaints.at(-1)?.contactEmail === 'me@example.com');

  console.log('\n== Mixed ==');
  before = rows();
  await type(user, '/complaint');
  at = await type(user, 'casino');
  at = await type(user, '3');
  check('typed number with list buttons on screen picks it and removes the buttons', texts(at)[0] === en.complaint.askSubject && cleared(at) >= 1);
  await type(user, 'Subject');
  at = await type(user, 'Details.');
  at = await type(user, 'done');
  check('typed "done" removes evidence buttons', texts(at).at(-1) === en.complaint.askEmail && cleared(at) >= 1);
  at = await tap(user, dataFor(at, 's'));
  at = await type(user, 'yes');
  check('mixed flow saves one row (Charlie)', rows() === before + 1 && db.complaints.at(-1)?.casinoId === 'c-charlie');

  console.log('\n== Casino fallback "none" by button ==');
  before = rows();
  await type(user, '/complaint');
  at = await type(user, 'casino');
  at = await tap(user, dataFor(at, 'x'));
  check('None of these -> recorded as typed, then subject', JSON.stringify(texts(at)) ===
    JSON.stringify([t('complaint.recordCasino', { input: 'casino' }, 'en'), en.complaint.askSubject]), texts(at));
  for (const input of ['S', 'D.', 'skip', 'skip', 'yes']) await type(user, input);
  check('saved with no casinoId and the typed name', rows() === before + 1 && db.complaints.at(-1)?.casinoId === null &&
    db.complaints.at(-1)?.casinoName === 'casino');

  console.log('\n== Cancel at every step ==');
  for (const [step, input] of [['casino yes/no', 'stake'], ['casino list', 'casino']]) {
    before = rows();
    await type(user, '/complaint');
    at = await type(user, input);
    at = await type(user, '/cancel');
    check(`typed /cancel at ${step}: cancelled, buttons removed, nothing saved`, cancelled(at) && cleared(at) >= 1 && rows() === before);
  }
  const steps: [string, string[]][] = [
    ['casino question', []],
    ['casino yes/no', ['stake']],
    ['casino list', ['casino']],
    ['subject', ['stake', 'yes']],
    ['details', ['stake', 'yes', 'S']],
    ['evidence', ['stake', 'yes', 'S', 'D.']],
    ['email', ['stake', 'yes', 'S', 'D.', 'skip']],
    ['second email try', ['stake', 'yes', 'S', 'D.', 'skip', 'not-an-email']],
    ['confirm', ['stake', 'yes', 'S', 'D.', 'skip', 'skip']],
  ];
  for (const [step, inputs] of steps) {
    before = rows();
    at = await type(user, '/complaint');
    for (const input of inputs) at = await type(user, input);
    const cancelData = dataFor(at, 'c');
    at = await tap(user, cancelData);
    check(`Cancel at ${step}: same message as /cancel, nothing saved, buttons removed`,
      cancelled(at) && texts(at).length === 1 && rows() === before && cleared(at) >= 1, texts(at));
    at = await tap(user, cancelData);
    check(`...tapping it again: "ended" popup only`, since(at, 'answerCallbackQuery')[0]?.payload.text === en.complaint.flowEnded && texts(at).length === 0);
  }
  at = await type(user, '/cancel');
  check('/cancel with nothing running unchanged', texts(at)[0] === en.complaint.nothingToCancel);

  console.log('\n== Confirm cannot save twice ==');
  const reachConfirm = async (who: User) => {
    let from = await type(who, '/complaint');
    for (const input of ['stake', 'yes', 'S', 'D.', 'skip', 'skip']) from = await type(who, input);
    return dataFor(from, 'ok');
  };
  before = rows();
  let ok = await reachConfirm(user);
  await tap(user, ok);
  at = await tap(user, ok);
  check('Confirm tapped twice in a row: one row; the second gets the "ended" popup', rows() === before + 1 &&
    since(at, 'answerCallbackQuery')[0]?.payload.text === en.complaint.flowEnded);
  // bot.start() long polling handles one update at a time, so two quick taps arrive as two back-to-back updates.
  before = rows();
  ok = await reachConfirm(user);
  at = calls.length;
  const doubleTap = [tapUpdate(user, ok), tapUpdate(user, ok)];
  for (const update of doubleTap) await send(update);
  taps += 2;
  check('Confirm double-tapped (two updates in one batch): one row, both taps answered', rows() === before + 1 &&
    since(at, 'answerCallbackQuery').length === 2, { rows: rows() - before, answers: since(at, 'answerCallbackQuery').map((c) => c.payload.text) });
  before = rows();
  ok = await reachConfirm(user);
  await tap(user, ok);
  at = await type(user, 'yes');
  check('Confirm then a typed "yes": one row, the "yes" starts nothing', rows() === before + 1 && !texts(at).some((x) => /BCGS-/.test(x)));
  before = rows();
  ok = await reachConfirm(user);
  at = calls.length;
  for (const update of [textUpdate(user, 'yes'), tapUpdate(user, ok)]) await send(update);
  taps += 1;
  check('typed "yes" arriving just before Confirm: one row, the tap gets the "ended" popup', rows() === before + 1 &&
    since(at, 'answerCallbackQuery')[0]?.payload.text === en.complaint.flowEnded, rows() - before);

  console.log('\n== Stale after timeout ==');
  at = await type(user, '/complaint');
  at = await type(user, 'stake');
  const staleYes = dataFor(at, 'y');
  advanceMinutes(31);
  before = rows();
  at = await tap(user, staleYes);
  check('after 30 minutes: expiry notice, "ended" popup, buttons removed, nothing resumes',
    texts(at).includes(en.complaint.expired) && since(at, 'answerCallbackQuery')[0]?.payload.text === en.complaint.flowEnded &&
    cleared(at) === 1 && !texts(at).includes(en.complaint.askSubject) && rows() === before, texts(at));

  console.log('\n== Buttons from an earlier flow, and other buttons, during a flow ==');
  at = await type(user, '/complaint');
  at = await type(user, 'stake');
  const oldFlowYes = dataFor(at, 'y');
  await type(user, '/cancel');
  await type(user, '/complaint');
  at = await tap(user, oldFlowYes);
  check('button from the cancelled flow: "ended" popup, no "middle of a submission" reply, current flow untouched',
    since(at, 'answerCallbackQuery')[0]?.payload.text === en.complaint.flowEnded && texts(at).length === 0);
  at = await type(user, 'stake');
  check('...the new flow still asks about the casino', texts(at)[0] === t('complaint.confirmCasino', { casinoName: 'Stake' }, 'en'));
  const currentYes = dataFor(at, 'y');
  at = await tap(user, 'v:stake');
  check('a card button still gets the "middle of a submission" reply', JSON.stringify(texts(at)) ===
    JSON.stringify([t('complaint.middleOfFlow', { label: 'complaint' }, 'en')]));
  at = await tap(user, 'lang:th');
  check('a language button too', texts(at)[0] === t('complaint.middleOfFlow', { label: 'complaint' }, 'en'));
  at = await type(user, '📝 Complaint');
  check('a bottom-keyboard label too', texts(at)[0] === t('complaint.middleOfFlow', { label: 'complaint' }, 'en'));
  const intruder = tapUpdate(user, currentYes) as any;
  intruder.callback_query.from.id = 9999;
  at = await tap(user, currentYes, intruder);
  check('someone else tapping this flow\'s button: popup only, flow untouched', since(at, 'answerCallbackQuery')[0]?.payload.text === en.complaint.flowEnded &&
    texts(at).length === 0);
  at = await tap(user, currentYes);
  check('the user\'s own tap still works', texts(at)[0] === en.complaint.askSubject);
  at = await tap(user, currentYes);
  check('the same Yes again (already answered): popup, nothing changes', since(at, 'answerCallbackQuery')[0]?.payload.text === en.buttons.unavailable &&
    texts(at).length === 0);
  await type(user, '/cancel');

  console.log('\n== Preselected casino (card button) ==');
  at = await tap(user, 'cp:stake');
  check('subject question has Cancel', texts(at).at(-1) === en.complaint.askSubject && flowRows(at)[0]?.[0]?.[0] === '✖️ Cancel');
  at = await tap(user, dataFor(at, 'c'));
  check('Cancel works there too', cancelled(at));

  console.log('\n== Groups ==');
  const groupUser: User = { id: 6002, language_code: 'en' };
  at = await send(tapUpdate(groupUser, 'f:abc123:ok', { chatType: 'supergroup' }));
  taps += 1;
  check('a forged flow button in a group: "ended" popup only', since(at, 'answerCallbackQuery')[0]?.payload.text === en.complaint.flowEnded &&
    texts(at).length === 0 && since(at, 'answerCallbackQuery').length === 1);

  console.log('\n== Chinese and Thai ==');
  const zhUser: User = { id: 6003 };
  settings.set('6003', 'zh');
  before = rows();
  await type(zhUser, '/complaint');
  at = await type(zhUser, 'stake');
  check('zh Yes/No', JSON.stringify(flowRows(at).map((r) => r.map(([label]) => label))) === JSON.stringify([['✅ 是', '❌ 否'], ['✖️ 取消']]));
  at = await tap(zhUser, dataFor(at, 'y'));
  await type(zhUser, '主题');
  at = await type(zhUser, '详情');
  check('zh evidence', JSON.stringify(flowRows(at).map((r) => r.map(([label]) => label))) === JSON.stringify([['✅ 完成', '⏭️ 跳过'], ['✖️ 取消']]));
  at = await type(zhUser, '跳过');
  check('typed 跳过 still works', texts(at).at(-1) === zh.complaint.askEmail);
  at = await tap(zhUser, dataFor(at, 's'));
  check('zh Confirm / Cancel', JSON.stringify(flowRows(at).map((r) => r.map(([label]) => label))) === JSON.stringify([['✅ 确认', '✖️ 取消']]));
  const zhConfirm = dataFor(at, 'ok');
  at = await type(zhUser, '是');
  check('typed 是 confirms, one row, Confirm buttons removed', rows() === before + 1 && cleared(at) >= 1);
  at = await tap(zhUser, zhConfirm);
  check('zh "ended" popup on the old Confirm', since(at, 'answerCallbackQuery')[0]?.payload.text === zh.complaint.flowEnded && rows() === before + 1);
  const thUser: User = { id: 6004 };
  settings.set('6004', 'th');
  before = rows();
  await type(thUser, '/complaint');
  at = await type(thUser, 'casino');
  check('th list ends with None of these, then Cancel', flowRows(at).at(-2)?.[0]?.[0] === '🚫 ไม่ใช่ทั้งหมด' &&
    flowRows(at).at(-1)?.[0]?.[0] === '✖️ ยกเลิก');
  at = await type(thUser, 'ไม่มี');
  check('typed ไม่มี (none) still works', texts(at)[0] === t('complaint.recordCasino', { input: 'casino' }, 'th'));
  await type(thUser, 'หัวข้อ');
  at = await type(thUser, 'รายละเอียด');
  check('th evidence', JSON.stringify(flowRows(at).map((r) => r.map(([label]) => label))) === JSON.stringify([['✅ เสร็จสิ้น', '⏭️ ข้าม'], ['✖️ ยกเลิก']]));
  at = await type(thUser, 'เสร็จ');
  at = await type(thUser, 'ข้าม');
  check('th Confirm / Cancel', JSON.stringify(flowRows(at).map((r) => r.map(([label]) => label))) === JSON.stringify([['✅ ยืนยัน', '✖️ ยกเลิก']]));
  at = await tap(thUser, dataFor(at, 'c'));
  check('th Cancel = th cancelled message, nothing saved', texts(at).at(-1) === th.complaint.cancelled && rows() === before);
  at = await tap(thUser, 'f:zzzzzz:y');
  check('th "ended" popup', since(at, 'answerCallbackQuery')[0]?.payload.text === th.complaint.flowEnded);

  console.log('\n== Sizes ==');
  const width = (text: string) => [...text].reduce((sum, ch) =>
    sum + (/[\p{M}\uFE0F]/u.test(ch) ? 0 : /[\p{Extended_Pictographic}\p{Script=Han}\u3000-\u303F\uFF00-\uFFEF]/u.test(ch) ? 2 : 1), 0);
  const paired = calls.flatMap((c) => c.payload.reply_markup?.inline_keyboard ?? []).filter((row: any[]) => row.length === 2)
    .flat().map((b: any) => b.text as string);
  const widest = [...new Set(paired)].sort((a, b) => width(b) - width(a))[0] ?? '';
  check(`labels sharing a row fit half a row (widest "${widest}" = ${width(widest)} cells, under "🌐 Visit Website" = 16)`,
    paired.every((text) => width(text) <= 16));
  check('rows have at most 2 buttons', calls.flatMap((c) => c.payload.reply_markup?.inline_keyboard ?? []).every((row: any[]) => row.length <= 2));
  const flowData = calls.flatMap((c) => c.payload.reply_markup?.inline_keyboard?.flat() ?? []).map((b: any) => b.callback_data)
    .filter((d: string | undefined) => d?.startsWith('f:'));
  check(`all ${flowData.length} flow callback data <= 64 bytes (longest ${Math.max(...flowData.map((d: string) => d.length))})`,
    flowData.every((d: string) => Buffer.byteLength(d) <= 64));
  check(`every one of ${taps} taps answered`, unanswered.length === 0, unanswered);
  check('one prisma.complaint.create per confirmed submission (no updates in the stub)', db.complaints.every((row) => typeof row.caseId === 'string'));

  finish();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
