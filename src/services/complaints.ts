import { prisma } from '../prisma';

export async function countRecentComplaintsByUser(
  telegramUserId: bigint | number | string,
  sinceHours: number,
): Promise<number> {
  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
  return prisma.complaint.count({
    where: {
      telegramUserId: String(telegramUserId),
      createdAt: { gte: since },
    },
  });
}
