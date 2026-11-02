import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { useToast } from "~/components/ui/Toast";
import { HeartIcon } from "~/components/ui/icons";
import { stashPendingWishlist, toggleWishlist } from "~/features/discovery/wishlist";

/**
 * Wishlist heart (S-13/US-12): optimistic toggle; guests are routed to
 * sign-in with the intent stashed, then the item saves automatically.
 */
export function WishlistHeart({
  productId,
  initial = false,
  className = "",
}: {
  productId: string;
  initial?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const params = useParams();
  const lang = params.lang === "en" ? "en" : "ar";
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    const res = await toggleWishlist(productId);
    if (res.auth) {
      stashPendingWishlist(productId);
      toast.showToast("info", t("store.wish.signInFirst"));
      navigate(`/${lang}/auth/login?next=` + encodeURIComponent(location.pathname + location.search));
      setBusy(false);
      return;
    }
    if (res.ok) {
      setSaved(Boolean(res.added));
      toast.showToast("success", t(res.added ? "store.wish.added" : "store.wish.removed"));
    } else {
      toast.showToast("error", t("errors.generic"));
    }
    setBusy(false);
  };

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void toggle();
      }}
      aria-pressed={saved}
      aria-label={t(saved ? "store.wish.remove" : "store.wish.add")}
      className={`flex size-9 cursor-pointer items-center justify-center rounded-full bg-surface/95 shadow-1 transition-colors duration-150 hover:text-action ${saved ? "text-action" : "text-text-muted"} ${className}`}
    >
      <HeartIcon filled={saved} className="size-4.5" />
    </button>
  );
}
