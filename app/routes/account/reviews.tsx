import { Link, data, useFetcher } from "react-router";
import type { Route } from "./+types/reviews";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { listOwnReviews } from "~/features/orders/api";
import { parseReviewMedia, type ReviewMediaItem } from "~/lib/review-media";
import { Rating } from "~/components/ui/Rating";
import { ReviewMediaPicker, ReviewMediaThumbs } from "~/components/catalog/ReviewMediaPicker";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonPage } from "~/components/ui/Skeleton";


/**
 * Account reviews (JOURNEYS §10): pending/published list; the buyer edits
 * (back to moderation) or deletes their own — RLS limits every write.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "account", request);
  const reviews = await listOwnReviews(client);
  return { lang, reviews: JSON.parse(JSON.stringify(reviews)) };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "account", request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = String(form.get("id") ?? "");

  if (intent === "edit") {
    // edits return the review to moderation (status → pending)
    const { error } = await client
      .from("reviews")
      .update({
        rating: Number(form.get("rating") ?? 5),
        title: String(form.get("title") ?? "").slice(0, 200),
        body: String(form.get("body") ?? "").slice(0, 2000),
        media: parseReviewMedia(form.get("media")),
        status: "pending",
      })
      .eq("id", id);
    return error ? data({ ok: false, reason: "failed" }, { status: 400 }) : { ok: true as const };
  }
  if (intent === "delete") {
    const { error } = await client.from("reviews").delete().eq("id", id);
    return error ? data({ ok: false, reason: "failed" }, { status: 400 }) : { ok: true as const };
  }
  return data({ ok: false, reason: "bad_intent" }, { status: 400 });
}

export default function AccountReviewsPage({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const fetcher = useFetcher<typeof action>();
  return (
    <div>
      {loaderData.reviews.length === 0 ? (
        <p className="text-sm text-text-muted">{t("reviews.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {loaderData.reviews.map((r: {
            id: string; rating: number; title: string; body: string; status: string; created_at: string;
            media?: ReviewMediaItem[] | null;
            product: { name_ar: string; name_en: string; slug_ar: string; slug_en: string } | null;
          }) => (
            <li key={r.id} className="rounded-md border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-bold text-text">
                  {r.product ? (
                    <Link
                      to={`/${loaderData.lang}/product/${encodeURIComponent(en ? r.product.slug_en : r.product.slug_ar)}`}
                      className="text-action hover:underline"
                    >
                      {en ? r.product.name_en : r.product.name_ar}
                    </Link>
                  ) : "—"}
                </span>
                <span className="flex items-center gap-2 text-xs">
                  <Rating value={r.rating} size="sm" />
                  <span className="num font-extrabold text-text">{r.rating}</span>
                  <span className={`rounded-md px-2 py-0.5 font-bold ${r.status === "published" ? "bg-surface-tint text-text" : "bg-surface-tint text-text-muted"}`}>
                    {t(`reviews.status_${r.status}`)}
                  </span>
                </span>
              </div>
              {r.title ? <p className="mt-1 text-sm font-bold text-text">{r.title}</p> : null}
              {r.body ? <p className="text-sm text-text-muted">{r.body}</p> : null}
              <ReviewMediaThumbs media={r.media ?? []} alt={en ? r.product?.name_en ?? "" : r.product?.name_ar ?? ""} />

              <details className="mt-2">
                <summary className="cursor-pointer text-xs font-bold text-action">{t("reviews.edit")}</summary>
                <EditReviewForm review={r} />
              </details>
              <fetcher.Form method="post" preventScrollReset className="mt-2">
                <input type="hidden" name="intent" value="delete" />
                <input type="hidden" name="id" value={r.id} />
                <button type="submit" className="cursor-pointer text-xs font-bold text-danger hover:underline">
                  {t("reviews.delete")}
                </button>
              </fetcher.Form>
            </li>
          ))}
        </ul>
      )}
      {fetcher.data && !fetcher.data.ok ? (
        <p role="alert" className="mt-2 text-sm text-danger">{t("reviews.failed")}</p>
      ) : null}
    </div>
  );
}


/** The edit form: real stars + the review's existing media, editable. */
function EditReviewForm({ review }: { review: { id: string; rating: number; title: string; body: string; media?: ReviewMediaItem[] | null } }) {
  const { t } = useTranslation();
  const fetcher = useFetcher<{ ok: boolean; reason?: string }>();
  const [rating, setRating] = useState(Number(review.rating) || 5);
  const [media, setMedia] = useState<ReviewMediaItem[]>(review.media ?? []);
  return (
    <fetcher.Form method="post" preventScrollReset className="mt-2 flex flex-col gap-2">
      <input type="hidden" name="intent" value="edit" />
      <input type="hidden" name="id" value={review.id} />
      <input type="hidden" name="rating" value={rating} />
      <Rating value={rating} onChange={setRating} size="lg" />
      <input name="title" defaultValue={review.title} maxLength={200} className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text" />
      <textarea name="body" defaultValue={review.body} rows={3} maxLength={2000} className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text" />
      <ReviewMediaPicker value={media} onChange={setMedia} />
      <div className="flex gap-2">
        <button type="submit" disabled={fetcher.state !== "idle"} className="cursor-pointer rounded-md bg-action px-4 py-2 text-sm font-bold text-on-action hover:bg-action-hover disabled:opacity-50">
          {t("reviews.saveEdit")}
        </button>
      </div>
      {fetcher.data && !fetcher.data.ok ? (
        <p role="alert" className="text-xs text-danger">
          {fetcher.data.reason === "bad_media" ? t("reviews.badMedia") : t("reviews.failed")}
        </p>
      ) : null}
    </fetcher.Form>
  );
}

/** H-06: friendly route error page (500s log a CORERR id; 403/404 keep their message) */
export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonPage />;
}
