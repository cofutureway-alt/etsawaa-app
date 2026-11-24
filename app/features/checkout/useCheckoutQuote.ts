import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type { CheckoutQuote } from "~/features/checkout/pricing.server";

/**
 * Client-side live quote state for checkout (JOURNEYS §6).
 *
 * Owns the `intent: "quote"` fetcher and re-submits it whenever the EFFECTIVE
 * governorate (selected saved address in "saved" mode, chosen governorate in
 * "new" mode) or the applied coupon changes. The quote that comes back feeds
 * the order summary, the COD block reasons and the shipping step; it stays
 * display-only — fn_create_order re-prices on placement.
 */

/** Serialized response of the checkout action's `intent: "quote"` branch. */
type QuoteResponse = { ok: true; quote: CheckoutQuote } | { ok: false; reason: string };

export interface CheckoutQuoteInput {
  /** guests never reach the accordion; the hook must not fire requests */
  guest: boolean;
  /** "saved" = shipping follows the selected saved address, "new" = the form */
  addressMode: "saved" | "new";
  /** governorate of the currently selected saved address (null when none) */
  selectedGovId: number | null;
  /** governorate picked in the new-address form */
  govId: number | null;
  /** applied coupon code (empty string = none) */
  couponCode: string;
  /** the loader's initial quote, before any client re-quote */
  initialQuote: CheckoutQuote | null;
}

export interface CheckoutQuoteState {
  quote: CheckoutQuote | null;
  /** true while a re-quote request is in flight (coupon Apply button) */
  quotePending: boolean;
}

export function useCheckoutQuote({
  guest, addressMode, selectedGovId, govId, couponCode, initialQuote,
}: CheckoutQuoteInput): CheckoutQuoteState {
  const quoteFetcher = useFetcher<QuoteResponse>();
  const [quote, setQuote] = useState<CheckoutQuote | null>(initialQuote);

  const quoteFor = (governorateId: number | null, coupon: string) => {
    quoteFetcher.submit(
      { intent: "quote", governorate_id: governorateId ?? "", coupon_code: coupon },
      { method: "post", preventScrollReset: true },
    );
  };

  // re-quote whenever the effective governorate or the coupon changes
  const quotedGovRef = useRef<number | null>(null);
  const quotedCouponRef = useRef("");
  useEffect(() => {
    if (guest) return;
    const effGov = addressMode === "saved" ? (selectedGovId ?? null) : govId;
    if (quotedGovRef.current !== effGov || quotedCouponRef.current !== couponCode) {
      quotedGovRef.current = effGov;
      quotedCouponRef.current = couponCode;
      quoteFor(effGov, couponCode);
    }
    // Every input of effGov is a dep (selectedGovId included: switching
    // between saved addresses keeps addressMode "saved" and govId unchanged,
    // so without it the quote kept the previous governorate's shipping/COD).
    // The ref stamps make re-runs idempotent; only the non-memoized quoteFor
    // is left out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guest, addressMode, selectedGovId, govId, couponCode]);

  useEffect(() => {
    if (quoteFetcher.data && "quote" in quoteFetcher.data && quoteFetcher.data.quote) {
      setQuote(quoteFetcher.data.quote as CheckoutQuote);
    }
  }, [quoteFetcher.data]);

  return { quote, quotePending: quoteFetcher.state !== "idle" };
}
