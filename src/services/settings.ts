import { prisma } from '../prisma';

const TELEGRAM_KEY = 'telegram_channel_url';
const DISCORD_KEY = 'discord_channel_url';

export type CommunityLinks = {
  telegram: string | undefined;
  discord: string | undefined;
};

export async function getCommunityLinks(): Promise<CommunityLinks> {
  const rows = await prisma.siteSetting.findMany({
    where: { key: { in: [TELEGRAM_KEY, DISCORD_KEY] } },
    select: { key: true, value: true },
  });
  const byKey = new Map(rows.map((row) => [row.key, row.value.trim()]));

  return {
    telegram: byKey.get(TELEGRAM_KEY),
    discord: byKey.get(DISCORD_KEY),
  };
}
