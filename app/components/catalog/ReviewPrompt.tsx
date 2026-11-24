import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Dialog } from "~/components/ui/Overlay";
import { Rating } from "~/components/ui/Rating";
import { Button } from "~/components/ui/Button";
import { CheckIcon } from "~/components/ui/icons";
import { ReviewMediaPicker } from "./ReviewMediaPicker";
import type { ReviewMediaItem } from "~/lib/review-media";

/**
 * Post-purchase review prompt: a buyer back on the page of a product they
 * received and never reviewed is asked once per visit (dismiss = not again in
 * this browser session). Submits through the product route action → fn_submit_review.
 */
export function ReviewPrompt({ orderItemId, productName }: { orderItemId: string; productName: string }) {
  const { t } = useTranslation();
  const fetcher = useFetcher<{ ok: boolean; reason?: string }>();
  const key = `etsawaa:review-prompt:${orderItemId}`;
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState("");
  const [media, setMedia] = useState<ReviewMediaItem[]>([]);

  useEffect(() => {
    let seen = false;
    try { seen = sessionStorage.getItem(key) === "1"; } catch { /* private mode */ }
    if (seen) return;
    const timer = window.setTimeout(() => setOpen(true), 1500);
    return () => window.clearTimeout(timer);
  }, [key]);

  const remember = () => { try { sessionStorage.setItem(key, "1"); } catch { /* ignore */ } };
  const close = () => { setOpen(false); remember(); };
  const done = fetcher.data?.ok === true;

  return (
    <Dialog open={open} onClose={close} title={done ? t("reviewPrompt.thanksTitle") : t("reviewPrompt.title")}>
      {done ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-success-soft text-success-strong"><CheckIcon className="size-6" /></span>
          <p className="text-sm text-text-muted">{t("reviewPrompt.thanksBody")}</p>
          <Button onClick={close}>{t("common.close")}</Button>
        </div>
      ) : (
        <fetcher.Form method="post" className="flex flex-col gap-4" onSubmit={remember}>
          <input type="hidden" name="intent" value="review" />
          <input type="hidden" name="order_item_id" value={orderItemId} />
          <input type="hidden" name="rating" value={rating} />
          <p className="text-sm text-text-muted">{t("reviewPrompt.body", { name: productName })}</p>
          <div className="flex justify-center"><Rating value={rating} onChange={setRating} size="lg" /></div>
          <label className="flex flex-col gap-1.5 text-sm font-bold text-text">
            {t("reviewPrompt.comment")}
            <textarea name="body" value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={2000}
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-normal" placeholder={t("reviewPrompt.placeholder")} />
          </label>
          <ReviewMediaPicker value={media} onChange={setMedia} />
          {fetcher.data && !fetcher.data.ok ? (
            <p className="text-sm text-danger">
              {fetcher.data.reason === "bad_media" ? t("reviews.badMedia") : t("reviewPrompt.error")}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>{t("reviewPrompt.later")}</Button>
            <Button type="submit" disabled={rating < 1} loading={fetcher.state !== "idle"}>{t("reviewPrompt.submit")}</Button>
          </div>
        </fetcher.Form>
      )}
    </Dialog>
  );
}
