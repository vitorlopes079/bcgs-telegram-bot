import { randomInt } from 'node:crypto';
import { conversations, createConversation, type Conversation } from '@grammyjs/conversations';
import { Prisma, type ReportType } from '@prisma/client';
import { InlineKeyboard, type Bot, type Context } from 'grammy';
import type { Message } from 'grammy/types';
import type { BotContext } from '../context';
import { prisma } from '../prisma';
import { findCasinos } from '../services/casinos';
import { getLocale, t, type Locale, type MessageKey } from '../i18n';
import { countRecentComplaintsByUser } from '../services/complaints';

const CONVERSATION_ID = 'submission';
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_SUBMISSIONS_PER_WINDOW = 3;
const WINDOW_HOURS = 24;
const MAX_CASINO_CHOICES = 5;
const MAX_SUBJECT_LENGTH = 200;
const MAX_ATTACHMENTS = 10;
// Bot API getFile cannot download anything larger, so admins could never retrieve it.
const MAX_ATTACHMENT_MB = 20;
const MAX_ATTACHMENT_BYTES = MAX_ATTACHMENT_MB * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf', 'mp4', 'txt']);
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'video/mp4',
  'text/plain',
]);
const SUMMARY_DETAILS_PREVIEW = 800;
const MAX_CASE_ID_ATTEMPTS = 5;
const ADMIN_SUBJECT_PREVIEW = 100;

const LABELS: Record<ReportType, MessageKey> = {
  complaint: 'complaint.typeComplaint',
  scam_report: 'complaint.typeReport',
};

type SubmissionConversation = Conversation<BotContext, Context>;

type CasinoChoice = { casinoId: string | null; casinoName: string };

export type SubmissionData = {
  type: ReportType;
  casinoId: string | null;
  casinoName: string | null;
  telegramUserId: string;
  contactName: string | null;
  contactEmail: string | null;
  subject: string;
  description: string;
  evidenceUrls: string[];
};

class FlowCancelled extends Error {}

function isCancelCommand(text: string): boolean {
  return /^\/cancel(@\S+)?(\s|$)/i.test(text);
}

async function waitForText(conversation: SubmissionConversation, label: string, locale: Locale): Promise<string> {
  while (true) {
    const next = await conversation.waitFor('message:text', {
      otherwise: (ctx) => ctx.reply(t('complaint.replyTextOrCancel', {}, locale)),
    });
    const text = next.message.text.trim();

    if (isCancelCommand(text)) throw new FlowCancelled();
    if (text.startsWith('/')) {
      await next.reply(
        t('complaint.middleOfFlow', { label }, locale),
      );
      continue;
    }
    if (text) return text;
  }
}

async function askYesNo(
  conversation: SubmissionConversation,
  ctx: Context,
  label: string,
  prompt: string,
  locale: Locale,
): Promise<boolean> {
  await ctx.reply(prompt);
  while (true) {
    const answer = (await waitForText(conversation, label, locale)).toLowerCase();
    if (answer === 'yes' || answer === 'y') return true;
    if (answer === 'no' || answer === 'n') return false;
    await ctx.reply(t('complaint.yesNo', {}, locale));
  }
}

async function askCasino(
  conversation: SubmissionConversation,
  ctx: Context,
  label: string,
  locale: Locale,
): Promise<CasinoChoice> {
  await ctx.reply(t('complaint.askCasino', {}, locale));
  const input = await waitForText(conversation, label, locale);
  const unlisted: CasinoChoice = { casinoId: null, casinoName: input };

  const matches = await conversation.external(() => findCasinos(input, MAX_CASINO_CHOICES, locale));

  if (matches.length === 0) {
    await ctx.reply(t('complaint.casinoNotFound', { input }, locale));
    return unlisted;
  }

  // Every path here still asks yes/no or for a number; a fuzzy match is never accepted on its own.
  const strongMatch =
    matches.length === 1
      ? matches[0]
      : matches.find((match) => match.matchType === 'exact');

  if (strongMatch) {
    const confirmed = await askYesNo(
      conversation,
      ctx,
      label,
      t('complaint.confirmCasino', { casinoName: strongMatch.name }, locale),
      locale,
    );
    if (confirmed) return { casinoId: strongMatch.id, casinoName: strongMatch.name };
    if (matches.length === 1) {
      await ctx.reply(t('complaint.recordCasino', { input }, locale));
      return unlisted;
    }
  }

  const list = matches.map((match, index) => `${index + 1}. ${match.name}`).join('\n');
  await ctx.reply(
    t('complaint.foundCasinos', { list }, locale),
  );

  while (true) {
    const answer = await waitForText(conversation, label, locale);
    if (answer.toLowerCase() === 'none') {
      await ctx.reply(t('complaint.recordCasino', { input }, locale));
      return unlisted;
    }
    const choice = Number(answer);
    if (Number.isInteger(choice) && choice >= 1 && choice <= matches.length) {
      const match = matches[choice - 1];
      return { casinoId: match.id, casinoName: match.name };
    }
    await ctx.reply(t('complaint.chooseCasinoNumber', { count: matches.length }, locale));
  }
}

async function askSubject(
  conversation: SubmissionConversation,
  ctx: Context,
  label: string,
  locale: Locale,
): Promise<string> {
  await ctx.reply(t('complaint.askSubject', {}, locale));
  while (true) {
    const subject = await waitForText(conversation, label, locale);
    if (subject.length <= MAX_SUBJECT_LENGTH && !subject.includes('\n')) return subject;
    await ctx.reply(
      t('complaint.subjectTooLong', { maxLength: MAX_SUBJECT_LENGTH }, locale),
    );
  }
}

type AttachmentCheck =
  | { kind: 'accepted'; fileId: string }
  | { kind: 'unsupported' }
  | { kind: 'tooLarge' }
  | { kind: 'none' };

function isAllowedDocument(document: { mime_type?: string; file_name?: string }): boolean {
  const mimeType = document.mime_type?.toLowerCase();
  const fileName = document.file_name?.toLowerCase() ?? '';
  const extension = fileName.includes('.') ? fileName.split('.').pop() : undefined;
  return (
    (mimeType !== undefined && ALLOWED_MIME_TYPES.has(mimeType)) ||
    (extension !== undefined && ALLOWED_EXTENSIONS.has(extension))
  );
}

function checkAttachment(message: Message): AttachmentCheck {
  const photo = message.photo?.at(-1);
  const document = message.document;
  const file = photo ?? document;

  if (!file) {
    const otherMedia =
      message.video ?? message.audio ?? message.voice ?? message.video_note ?? message.sticker;
    return otherMedia ? { kind: 'unsupported' } : { kind: 'none' };
  }
  if (!photo && document && !isAllowedDocument(document)) return { kind: 'unsupported' };
  if ((file.file_size ?? 0) > MAX_ATTACHMENT_BYTES) return { kind: 'tooLarge' };
  return { kind: 'accepted', fileId: file.file_id };
}

async function askEvidence(
  conversation: SubmissionConversation,
  ctx: Context,
  label: string,
  locale: Locale,
): Promise<string[]> {
  await ctx.reply(t('complaint.askEvidence', {}, locale));
  const evidence: string[] = [];

  while (true) {
    const next = await conversation.waitFor('message');
    const message = next.message;
    const attachment = checkAttachment(message);

    if (attachment.kind === 'unsupported') {
      await next.reply(t('complaint.unsupportedFile', {}, locale));
      continue;
    }
    if (attachment.kind === 'tooLarge') {
      await next.reply(t('complaint.fileTooLarge', { maxMb: MAX_ATTACHMENT_MB }, locale));
      continue;
    }
    if (attachment.kind === 'accepted') {
      // Bot API file URLs embed the bot token and expire, so store the permanent file_id instead.
      evidence.push(`tg-file:${attachment.fileId}`);
      if (evidence.length >= MAX_ATTACHMENTS) {
        await next.reply(t('complaint.maxAttachments', { count: evidence.length }, locale));
        return evidence;
      }
      await next.reply(t('complaint.attachmentReceived', { count: evidence.length }, locale));
      continue;
    }

    const text = message.text?.trim() ?? '';
    if (isCancelCommand(text)) throw new FlowCancelled();
    const answer = text.toLowerCase();
    if (answer === 'skip' || answer === 'done') return evidence;

    await next.reply(
      evidence.length > 0
        ? t('complaint.sendMoreEvidence', {}, locale)
        : t('complaint.sendEvidenceOrSkip', {}, locale),
    );
  }
}

async function askEmail(
  conversation: SubmissionConversation,
  ctx: Context,
  label: string,
  locale: Locale,
): Promise<string | null> {
  await ctx.reply(t('complaint.askEmail', {}, locale));

  const first = await waitForText(conversation, label, locale);
  if (first.toLowerCase() === 'skip') return null;
  if (first.includes('@')) return first;

  await ctx.reply(t('complaint.invalidEmail', {}, locale));
  const second = await waitForText(conversation, label, locale);
  return second.toLowerCase() === 'skip' ? null : second;
}

function formatSummary(label: string, data: SubmissionData, casino: CasinoChoice, locale: Locale): string {
  const casinoLine = casino.casinoId
    ? casino.casinoName
    : t('complaint.notInDatabase', { casinoName: casino.casinoName ?? '' }, locale);
  const details =
    data.description.length > SUMMARY_DETAILS_PREVIEW
      ? `${data.description.slice(0, SUMMARY_DETAILS_PREVIEW)}…`
      : data.description;

  return [
    t('complaint.summaryTitle', { label }, locale),
    '',
    t('complaint.summaryCasino', { casinoLine }, locale),
    t('complaint.summarySubject', { subject: data.subject }, locale),
    t('complaint.summaryDetails', { details }, locale),
    t('complaint.summaryAttachments', { count: data.evidenceUrls.length }, locale),
    t('complaint.summaryEmail', { email: data.contactEmail ?? t('complaint.emailNotProvided', {}, locale) }, locale),
  ].join('\n');
}

function generateCaseId(): string {
  return `BCGS-${new Date().getUTCFullYear()}-${randomInt(10000, 100000)}`;
}

function isCaseIdCollision(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = error.meta?.target;
  return Array.isArray(target) ? target.includes('caseId') : String(target).includes('caseId');
}

async function countRecentSubmissions(telegramUserId: string): Promise<number | null> {
  try {
    return await countRecentComplaintsByUser(telegramUserId, WINDOW_HOURS);
  } catch {
    console.warn('Could not check complaint submission limit.');
    return null;
  }
}

function getSenderDisplay(ctx: Context): string | null {
  if (ctx.from?.username) return `@${ctx.from.username}`;
  const name = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ');
  return name || null;
}

function truncateSubject(subject: string): string {
  if (subject.length <= ADMIN_SUBJECT_PREVIEW) return subject;
  return `${subject.slice(0, ADMIN_SUBJECT_PREVIEW - 3).trimEnd()}...`;
}

type SaveSubmissionResult = { caseId: string } | { limitReached: true };

export async function saveSubmission(data: SubmissionData): Promise<SaveSubmissionResult> {
  for (let attempt = 1; ; attempt++) {
    const caseId = generateCaseId();
    const recentCount = await countRecentSubmissions(data.telegramUserId);
    if (recentCount !== null && recentCount >= MAX_SUBMISSIONS_PER_WINDOW) {
      return { limitReached: true };
    }

    try {
      await prisma.complaint.create({
        data: { ...data, caseId, source: 'telegram', status: 'open' },
        select: { caseId: true },
      });
      return { caseId };
    } catch (error) {
      if (attempt < MAX_CASE_ID_ATTEMPTS && isCaseIdCollision(error)) continue;
      throw error;
    }
  }
}

async function runSubmission(
  conversation: SubmissionConversation,
  ctx: Context,
  type: ReportType,
  locale: Locale,
): Promise<void> {
  const label = t(LABELS[type], {}, locale);
  const telegramUserId = String(ctx.from?.id ?? '');
  const recentCount = await conversation.external(() => countRecentSubmissions(telegramUserId));
  if (recentCount !== null && recentCount >= MAX_SUBMISSIONS_PER_WINDOW) {
    await ctx.reply(t('complaint.submissionLimit', { max: MAX_SUBMISSIONS_PER_WINDOW, hours: WINDOW_HOURS }, locale));
    return;
  }

  await ctx.reply(t('complaint.start', { label }, locale));

  const casino = await askCasino(conversation, ctx, label, locale);
  const subject = await askSubject(conversation, ctx, label, locale);

  await ctx.reply(t('complaint.describeIncident', {}, locale));
  const description = await waitForText(conversation, label, locale);

  const evidenceUrls = await askEvidence(conversation, ctx, label, locale);
  const contactEmail = await askEmail(conversation, ctx, label, locale);

  const data: SubmissionData = {
    type,
    casinoId: casino.casinoId,
    casinoName: casino.casinoId ? null : casino.casinoName,
    telegramUserId,
    contactName: getSenderDisplay(ctx),
    contactEmail,
    subject,
    description,
    evidenceUrls,
  };

  await ctx.reply(formatSummary(label, data, casino, locale));
  const confirmed = await askYesNo(
    conversation,
    ctx,
    label,
    t('complaint.confirmSubmission', { label }, locale),
    locale,
  );
  if (!confirmed) throw new FlowCancelled();

  const caseId = await conversation.external(async () => {
    try {
      return await saveSubmission(data);
    } catch (error) {
      console.error('Saving submission failed.');
      return null;
    }
  });

  if (!caseId) {
    await ctx.reply(t('complaint.saveFailed', {}, locale));
    return;
  }

  if ('limitReached' in caseId) {
    await ctx.reply(t('complaint.submissionLimit', { max: MAX_SUBMISSIONS_PER_WINDOW, hours: WINDOW_HOURS }, locale));
    return;
  }

  await ctx.reply(t('complaint.submitted', { caseId: caseId.caseId }, locale));

  await conversation.external(async () => {
    const adminChatId = process.env.ADMIN_CHAT_ID;
    if (!adminChatId) return;

    try {
      const notificationType = t(
        type === 'complaint' ? 'complaint.typeComplaint' : 'complaint.typeScamReport',
        {},
        locale,
      );
      await ctx.api.sendMessage(
        adminChatId,
        t('complaint.adminNotification', {
          caseId: caseId.caseId,
          type: notificationType,
          casinoName: casino.casinoName ?? data.casinoName ?? '',
          subject: truncateSubject(data.subject),
          sender: data.contactName ?? t('complaint.unknownSender', {}, locale),
        }, locale),
      );
    } catch {
      console.warn('Admin complaint notification failed.');
    }
  });
}

async function submission(conversation: SubmissionConversation, ctx: Context, type: ReportType) {
  const locale = getLocale(ctx);
  try {
    await runSubmission(conversation, ctx, type, locale);
  } catch (error) {
    if (!(error instanceof FlowCancelled)) throw error;
    await ctx.reply(t('complaint.cancelled', {}, locale));
  }
}

export function registerComplaintCommands(bot: Bot<BotContext>) {
  bot.use(
    conversations<BotContext, Context>({
      // Only reached on inactivity timeout; /cancel and "no" end the flow by returning normally.
      onExit: (_id, ctx) =>
        ctx.reply(t('complaint.expired', {}, getLocale(ctx))),
    }),
  );
  bot.use(
    createConversation<BotContext, Context>(submission, {
      id: CONVERSATION_ID,
      maxMillisecondsToWait: INACTIVITY_TIMEOUT_MS,
    }),
  );

  const start = (type: ReportType) => (ctx: BotContext) => startComplaintFlow(ctx, type);

  bot.command('complaint', start('complaint'));
  bot.command('report', start('scam_report'));
  bot.command('cancel', (ctx) => ctx.reply(t('complaint.nothingToCancel', {}, getLocale(ctx))));
}

export async function startComplaintFlow(ctx: BotContext, type: ReportType): Promise<void> {
  const locale = getLocale(ctx);
  if (ctx.chat?.type !== 'private') {
    const payload = type === 'complaint' ? 'complaint' : 'report';
    const url = `https://t.me/${ctx.me.username}?start=${payload}`;
    const keyboard = new InlineKeyboard().url(t('complaint.openPrivateChat', {}, locale), url);
    await ctx.reply(t('complaint.privacy', { label: t(LABELS[type], {}, locale) }, locale), {
      reply_markup: keyboard,
    });
    return;
  }
  await ctx.conversation.enter(CONVERSATION_ID, type);
}
