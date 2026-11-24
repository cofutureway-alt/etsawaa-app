import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type { Route } from "./+types/checkout";
import { useTranslation } from "react-i18next";
import { getI18n } from "~/lib/i18n/config";
import { publicMeta } from "~/lib/seo";
import { normalizeEgyptianPhone } from "~/lib/phone";
import { checkoutAction, loadCheckoutPage } from "~/features/checkout/checkout.server";
import { useCheckoutQuote } from "~/features/checkout/useCheckoutQuote";
import { useCheckoutAddressForm } from "~/features/checkout/useCheckoutAddressForm";
import { GuestGate } from "~/components/checkout/GuestGate";
import { BlockedItemsNotice, PlaceErrorSummary, type CheckoutPlaceError } from "~/components/checkout/CheckoutNotices";
import { AddressStep } from "~/components/checkout/AddressStep";
import { ShippingStep } from "~/components/checkout/ShippingStep";
import { PaymentStep } from "~/components/checkout/PaymentStep";
import { ConfirmStep } from "~/components/checkout/ConfirmStep";
import { OrderSummary } from "~/components/checkout/OrderSummary";
import type { StepViewState } from "~/components/checkout/StepHeader";
import { SkeletonPage } from "~/components/ui/Skeleton";
import { Dialog } from "~/components/ui/Overlay";
import { PhoneCodeBox } from "~/components/phone/PhoneCodeBox";


/**
 * Checkout (JOURNEYS §6): single-page accordion — account/address → shipping
 * → payment → confirm — with a sticky order summary. The email is displayed
 * READ-ONLY (AGENT §29); the alternate phone is required and must differ from
 * the primary; shipping is one fee by governorate; COD rules are re-decided
 * server-side on placement (forged requests fail in fn_create_order).
 *
 * Structural layout: the loader/action bodies live in
 * ~/features/checkout/checkout.server.ts, the quote re-fetch hook in
 * ~/features/checkout/useCheckoutQuote.ts, the address-form state (with the
 * H-21/H-23 prefill effects) in ~/features/checkout/useCheckoutAddressForm.ts
 * and the accordion sections in ~/components/checkout/*.
 */

export const meta: Route.MetaFunction = ({ params }) => {
  const lang = params.lang === "en" ? "en" : "ar";
  const t = getI18n(lang).t;
  return publicMeta({
    lang,
    path: "/checkout",
    title: `${t("checkout.title")} — ${t("app.name")}`,
    description: t("checkout.metaDescription"),
    noindex: true,
  });
};

export async function loader({ request, params }: Route.LoaderArgs) {
  return loadCheckoutPage(request, params);
}

export async function action({ request, params }: Route.ActionArgs) {
  return checkoutAction(request, params);
}

const STEPS = ["address", "shipping", "payment", "confirm"] as const;
type Step = (typeof STEPS)[number];

export default function CheckoutPage({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const lang = loaderData.lang;

  const [step, setStep] = useState<Step>("address");
  const [placed, setPlaced] = useState(false);
  const placeFetcher = useFetcher<typeof action>();

  // ---- address form state (all H-21/H-23 prefill logic lives in the hook)
  const addr = useCheckoutAddressForm({
    addresses: loaderData.addresses,
    profilePhone: loaderData.profilePhone,
    profileAlternatePhone: loaderData.profileAlternatePhone,
  });

  // ---- coupon + payment
  const [couponInput, setCouponInput] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"kashier" | "cod" | null>(null);
  const [terms, setTerms] = useState(false);
  const [phoneDone, setPhoneDone] = useState(false);
  const submitRef = useRef<() => void>(() => undefined);
  // verified: close the box and place the order again, now accepted
  const onPhoneVerified = useCallback(() => {
    setTimeout(() => { setPhoneDone(true); submitRef.current(); }, 700);
  }, []);

  // the governorate the quote/shipping must follow (saved pick or form pick)
  const effectiveGovId = addr.addressMode === "saved" ? (addr.selectedAddress?.governorate_id ?? null) : addr.govId;
  const activeGov = loaderData.governorates.find((g) => g.id === effectiveGovId) ?? null;

  // live quote (shipping fee + coupon + COD state) — the hook owns the fetcher
  const { quote, quotePending } = useCheckoutQuote({
    guest: loaderData.guest,
    addressMode: addr.addressMode,
    selectedGovId: addr.selectedAddress?.governorate_id ?? null,
    govId: addr.govId,
    couponCode,
    initialQuote: loaderData.quote,
  });

  useEffect(() => {
    const d = placeFetcher.data;
    if (d && "reason" in d && !d.ok) {
      // error summary gets focus (design skill: focusable error summary)
      document.getElementById("checkout-error-summary")?.focus();
    }
  }, [placeFetcher.data]);

  // block placement until the cart actually reached checkout
  const sellable = quote?.lines.filter((l) => l.listable) ?? [];
  const totals = quote?.totals ?? null;
  const codState = quote?.cod ?? { allowed: false, reason: null as null, cap_piastres: loaderData.codCap };
  // COD picked, then the quote changed (cap, vendor-shipped item, COD switched off) → make them choose again
  useEffect(() => { if (paymentMethod === "cod" && quote && !codState.allowed) setPaymentMethod(null); }, [paymentMethod, quote, codState.allowed]);

  const canPlace =
    !placed && sellable.length > 0 && paymentMethod !== null && terms &&
    (addr.addressMode === "saved" ? addr.selectedAddressId !== "" : true);

  const groups = useMemo(() => {
    const map = new Map<string, typeof sellable>();
    for (const l of sellable) {
      const arr = map.get(l.vendor_id) ?? [];
      arr.push(l);
      map.set(l.vendor_id, arr);
    }
    return [...map.entries()];
  }, [quote]);

  /* ---------------- guest gate (US-01: cart resumes after signup) ---------------- */
  if (loaderData.guest) {
    return <GuestGate lang={lang} />;
  }

  const rawPlaceError = placeFetcher.data && "reason" in placeFetcher.data
    ? (placeFetcher.data as unknown as CheckoutPlaceError & { phone?: string })
    : null;
  // an unproven shipping number opens the code box instead of an error
  const phoneToVerify = rawPlaceError?.reason === "phone_unverified" ? rawPlaceError.phone ?? null : null;
  const placeError = phoneToVerify ? null : rawPlaceError;

  // address-step Continue: reveal every inline error, advance only when valid
  const continueFromAddress = () => {
    addr.touchAll();
    const pNorm = normalizeEgyptianPhone(addr.primaryPhone);
    const aNorm = normalizeEgyptianPhone(addr.alternatePhone);
    const valid =
      addr.addressMode === "saved"
        ? addr.selectedAddressId !== "" && pNorm.ok && aNorm.ok && pNorm.e164 !== aNorm.e164
        : Boolean(addr.fullName && addr.addr1 && addr.govId && addr.areaId && addr.err("phone_primary") === undefined && addr.err("phone_alternate") === undefined);
    if (valid) setStep("shipping");
  };

  const stepStates: Record<Step, StepViewState> = {
    address: {
      done: addr.addressDone,
      label: t("checkout.stepAddress"),
      value: addr.addressMode === "saved" && addr.selectedAddress ? (addr.selectedAddress.address1) : addr.addr1,
    },
    shipping: { done: Boolean(activeGov) && addr.addressDone, label: t("checkout.stepShipping"), value: activeGov ? (i18n.language?.startsWith("en") ? activeGov.name_en : activeGov.name_ar) : "" },
    payment: { done: paymentMethod !== null, label: t("checkout.stepPayment"), value: paymentMethod ? t(`checkout.pay_${paymentMethod}`) : "" },
    confirm: { done: false, label: t("checkout.stepConfirm"), value: "" },
  };

  const submitPlace = () => {
    setPhoneDone(false);
    const fd = new FormData();
    fd.set("intent", "place");
    fd.set("payment_method", paymentMethod ?? "");
    fd.set("attempt_key", loaderData.attemptKey);
    fd.set("coupon_code", couponCode);
    if (addr.addressMode === "saved") {
      fd.set("address_id", addr.selectedAddressId);
      fd.set("phone_alternate", addr.alternatePhone);
    } else {
      fd.set("full_name", addr.fullName);
      const p = normalizeEgyptianPhone(addr.primaryPhone);
      fd.set("phone_primary", p.ok ? p.e164 : addr.primaryPhone);
      const a = normalizeEgyptianPhone(addr.alternatePhone);
      fd.set("phone_alternate", a.ok ? a.e164 : addr.alternatePhone);
      fd.set("governorate_id", String(addr.govId ?? ""));
      fd.set("area_id", String(addr.areaId ?? ""));
      fd.set("address1", addr.addr1);
      fd.set("address2", addr.addr2);
      fd.set("postal_code", addr.postal);
    }
    // the pin applies in BOTH address modes (checkout-level choice)
    if (addr.pin) {
      fd.set("lat", String(addr.pin.lat));
      fd.set("lng", String(addr.pin.lng));
      if (addr.pin.accuracyM != null) fd.set("geo_accuracy", String(addr.pin.accuracyM));
    }
    setPlaced(true);
    placeFetcher.submit(fd, { method: "post", preventScrollReset: true });
    setTimeout(() => setPlaced(false), 8000);
  };

  submitRef.current = submitPlace;

  return (
    <div className="mx-auto w-full max-w-page px-4 py-6">
      <h1 className="mb-1 text-lg font-extrabold text-text">{t("checkout.title")}</h1>
      <p className="mb-4 text-sm text-text-muted">{t("checkout.subtitle")}</p>

      {placeError ? (
        <PlaceErrorSummary
          lang={lang}
          reason={placeError.reason}
          capPiastres={placeError.cap_piastres}
          names={placeError.names}
          fallbackCap={loaderData.codCap}
        />
      ) : null}

      <Dialog open={Boolean(phoneToVerify) && !phoneDone} onClose={() => setPhoneDone(true)} title={t("phoneCode.checkoutTitle")}>
        {phoneToVerify ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-muted">{t("phoneCode.checkoutLead")}</p>
            <PhoneCodeBox phone={phoneToVerify} purpose="checkout" lang={lang} onVerified={onPhoneVerified} />
          </div>
        ) : null}
      </Dialog>

      {quote && quote.blockedNames.length > 0 ? (
        <BlockedItemsNotice lang={lang} blockedNames={quote.blockedNames} />
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_360px]">
        {/* ---------------- accordion ---------------- */}
        <div className="flex flex-col gap-3">
          {/* Step 1 — account & address */}
          <AddressStep
            addr={addr}
            open={step === "address"}
            index={0}
            total={STEPS.length}
            stepState={stepStates.address}
            onOpen={() => setStep("address")}
            onContinue={continueFromAddress}
            lang={lang}
            viewerEmail={loaderData.viewerEmail}
            addresses={loaderData.addresses}
            governorates={loaderData.governorates}
            areas={loaderData.areas}
          />

          {/* Step 2 — shipping */}
          <ShippingStep
            open={step === "shipping"}
            index={1}
            total={STEPS.length}
            stepState={stepStates.shipping}
            onOpen={() => setStep("shipping")}
            onBack={() => setStep("address")}
            onContinue={() => setStep("payment")}
            activeGov={activeGov}
            totals={totals}
            couponCode={couponCode}
          />

          {/* Step 3 — payment */}
          <PaymentStep
            open={step === "payment"}
            index={2}
            total={STEPS.length}
            stepState={stepStates.payment}
            onOpen={() => setStep("payment")}
            onBack={() => setStep("shipping")}
            onContinue={() => setStep("confirm")}
            kashierAvailable={loaderData.kashier}
            kashierTest={loaderData.kashierTest}
            codState={codState}
            paymentMethod={paymentMethod}
            onPaymentMethod={setPaymentMethod}
          />

          {/* Step 4 — confirm */}
          <ConfirmStep
            open={step === "confirm"}
            index={3}
            total={STEPS.length}
            stepState={stepStates.confirm}
            onOpen={() => setStep("confirm")}
            onBack={() => setStep("payment")}
            lang={lang}
            defaultAddress={addr.defaultAddress}
            addressMode={addr.addressMode}
            fullName={addr.fullName}
            addr1={addr.addr1}
            paymentMethod={paymentMethod}
            terms={terms}
            onTermsChange={setTerms}
            canPlace={canPlace}
            placing={placeFetcher.state !== "idle"}
            onPlace={submitPlace}
          />
        </div>

        {/* ---------------- sticky summary ---------------- */}
        <OrderSummary
          lang={lang}
          groups={groups}
          totals={totals}
          couponInput={couponInput}
          onCouponInput={setCouponInput}
          onApplyCoupon={() => setCouponCode(couponInput.trim())}
          quotePending={quotePending}
        />
      </div>
    </div>
  );
}


/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonPage />;
}
