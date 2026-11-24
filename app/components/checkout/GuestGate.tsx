import { Link } from "react-router";
import { useTranslation } from "react-i18next";
// Layering exception: cart state is feature-owned; the gate reads the store
// hook directly to keep the items count live.
import { useCart } from "~/features/cart/store";
import { Button } from "~/components/ui/Button";

/**
 * US-01 guest gate (cart resumes after signup): the whole checkout page for
 * signed-out visitors — an account card with register/login links carrying
 * `next` so the cart is still here when they come back. The live cart count
 * is read straight from the cart store.
 */

export function GuestGate({ lang }: { lang: string }) {
  const { t } = useTranslation();
  const cart = useCart();
  return (
    <div className="mx-auto w-full max-w-lg px-4 py-10">
      <div className="rounded-md border border-border bg-surface p-6 text-center">
        <h1 className="text-lg font-extrabold text-text">{t("checkout.gateTitle")}</h1>
        <p className="mt-2 text-sm text-text-muted">{t("checkout.gateBody")}</p>
        <p className="mt-1 text-sm text-text-muted">
          {t("cart.itemsCount", { count: cart.ready ? cart.count : 0 })}
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <Link to={`/${lang}/auth/register?next=${encodeURIComponent(`/${lang}/checkout`)}`} className="block">
            <Button block size="lg">{t("checkout.gateRegister")}</Button>
          </Link>
          <Link to={`/${lang}/auth/login?next=${encodeURIComponent(`/${lang}/checkout`)}`} className="block">
            <Button block variant="outline" size="lg">{t("checkout.gateLogin")}</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
