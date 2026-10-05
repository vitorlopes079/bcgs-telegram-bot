import { ReviewStatus } from '@prisma/client';
import { prisma } from '../prisma';

export type CasinoReviewSummary = {
  editorialSummary: string | null;
  userRatingAvg: number | null;
  userRatingCount: number;
  latestReviews: {
    rating: number;
    body: string;
    createdAt: Date;
    authorName?: string;
  }[];
};

export async function getCasinoReviewSummary(
  casinoId: string,
  locale: string,
): Promise<CasinoReviewSummary> {
  const [translation, ratingSummary, latestReviews] = await Promise.all([
    prisma.casinoTranslation.findFirst({
      where: { casinoId, locale },
      select: { reviewBody: true },
    }),
    prisma.userReview.aggregate({
      where: { casinoId, status: ReviewStatus.published },
      _avg: { rating: true },
      _count: true,
    }),
    prisma.userReview.findMany({
      where: { casinoId, status: ReviewStatus.published },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 3,
      select: {
        rating: true,
        body: true,
        createdAt: true,
        user: { select: { displayName: true } },
      },
    }),
  ]);

  const userRatingCount = ratingSummary._count;
  const average = ratingSummary._avg.rating;

  return {
    editorialSummary: translation?.reviewBody || null,
    userRatingAvg:
      userRatingCount === 0 || average == null ? null : Math.round(average * 10) / 10,
    userRatingCount,
    latestReviews: latestReviews.map((review) => ({
      rating: review.rating,
      body: review.body,
      createdAt: review.createdAt,
      ...(review.user.displayName ? { authorName: review.user.displayName } : {}),
    })),
  };
}
