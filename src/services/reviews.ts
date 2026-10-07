import { ReviewStatus } from '@prisma/client';
import type { Locale } from '../i18n';
import { prisma } from '../prisma';
import { contentLocales, pickTranslated } from './translations';

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
  locale: Locale,
): Promise<CasinoReviewSummary> {
  const [translations, ratingSummary, latestReviews] = await Promise.all([
    prisma.casinoTranslation.findMany({
      where: { casinoId, locale: { in: contentLocales(locale) } },
      select: { locale: true, reviewBody: true },
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
    editorialSummary: pickTranslated(translations, 'reviewBody', locale) || null,
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
