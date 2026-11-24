/**
 * Review media list shared by the buyer forms and their route actions.
 * Shape matches `reviews.media`: at most 5 items, at most 2 videos, and every
 * path under the caller's own `u/<uid>/` folder (the DB re-checks all of it).
 */

export type ReviewMediaKind = "image" | "video";

export interface ReviewMediaItem {
  kind: ReviewMediaKind;
  path: string;
}

export const REVIEW_MEDIA_MAX = 5;
export const REVIEW_VIDEO_MAX = 2;

/** Form field (JSON) → a safe list; the database rejects anything else with `bad_media`. */
export function parseReviewMedia(raw: FormDataEntryValue | null | undefined): ReviewMediaItem[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .filter((item) => (item.kind === "image" || item.kind === "video") && typeof item.path === "string" && item.path.length > 0)
      .slice(0, REVIEW_MEDIA_MAX)
      .map((item) => ({ kind: item.kind as ReviewMediaKind, path: item.path as string }));
  } catch {
    return [];
  }
}
