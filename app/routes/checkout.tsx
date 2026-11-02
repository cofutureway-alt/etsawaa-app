import { useEffect, useMemo, useRef, useState } from "react";
import { Link, data, redirect, useFetcher } from "react-router";
import type { Route } from "./+types/checkout";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getSupabaseAdminClient } from "~/lib/supabase/admin";
import { getViewer } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { getSiteUrl } from "~/lib/env.server";
import { normalizeEgyptianPhone } from "~/lib/phone";
import { publicMeta } from "~/lib/seo";
import { loadCheckoutQuote, type CheckoutQuote } from "~/features/checkout/pricing.server";
import { buildKashierCheckoutUrl, isKashierConfigured } from "~/features/checkout/kashier.server";
import { sendOrderEmail } from "~/features/orders/emails.server";
import { useCart } from "~/features/cart/store";
import { Input } from "~/components/ui/Input";
import { Button } from "~/components/ui/Button";
import { LocationPicker } from "~/components/location/LocationPicker";
import { GovernateAreaSelects } from "~/components/location/GovernateAreaSelects";
import type { PinValue } from "~/components/checkout/MapPin";
import { MediaImg } from "~/components/catalog/MediaImg";
import { SkeletonPage } from "~/components/ui/Skeleton";


/**
 * Checkout (JOURNEYS §6): single-page accordion — account/address → shipping
 * → payment → confirm — with a sticky order summary. The email is displayed
 * READ-ONLY (AGENT §29); the alternate phone is required and must differ from
 * the primary; shipping is one fee by governorate; COD rules are re-decided
 * server-side on placement (forged requests fail in fn_create_order).
 */

export const meta: Route.MetaFunction = ({ params }) =>
  publicMeta({
    lang: params.lang === "en" ? "en" : "ar",
    path: "/checkout",
    title: params.lang === "en" ? "Checkout — Etsawaa" : "إتمام الطلب — اتسوء",
    description: params.lang === "en" ? "Complete your order." : "أكمل طلبك بخطوات واضحة.",
    noindex: true,
  });

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  const { viewer } = (await getViewer(client)) ?? { viewer: null };

  const [{ data: governorates }, { data: areas }] = await Promise.all([
    client.from("governorates").select("id, name_ar, name_en, shipping_fee_piastres, is_active").eq("is_active", true).order("sort"),
    client.from("areas").select("id, governorate_id, name_ar, name_en, is_active").eq("is_active", true).order("sort"),
  ]);

  if (!viewer) {
    return {
      lang, guest: true as const, viewerEmail: "", profilePhone: "", profileAlternatePhone: "",
      addresses: [] as Array<{ id: string; label: string | null; full_name: string; phone: string; phone_alternate: string | null; governorate_id: number; area_id: number; address1: string; address2: string | null; postal_code: string | null; is_default: boolean; lat: number | null; lng: number | null; geo_accuracy: number | null }>,
      governorates: [] as Array<{ id: number; name_ar: string; name_en: string; shipping_fee_piastres: number; is_active: boolean }>,
      areas: [] as Array<{ id: number; governorate_id: number; name_ar: string; name_en: string; is_active: boolean }>,
      quote: null, kashier: isKashierConfigured(), attemptKey: "",
      codCap: 500000,
    };
  }

  const [{ data: addresses }, { data: settingsRow }] = await Promise.all([
    client.from("user_addresses")
      .select("id, label, full_name, phone, phone_alternate, governorate_id, area_id, address1, address2, postal_code, is_default, lat, lng, geo_accuracy")
      .eq("user_id", viewer.user.id)
      .order("is_default", { ascending: false })
      .order("created_at"),
    client.from("settings").select("value").eq("key", "checkout").maybeSingle(),
  ]);

  const url = new URL(request.url);
  const govId = url.searchParams.get("governorate_id");
  const quote = await loadCheckoutQuote(client, viewer.user.id, {
    governorateId: govId ? Number(govId) : null,
    areaId: null,
    couponCode: url.searchParams.get("coupon"),
  });

  return {
    lang, guest: false as const,
    viewerEmail: viewer.user.email ?? "",
    profilePhone: viewer.profile.phone ?? "",
    profileAlternatePhone: viewer.profile.phone_alternate ?? "",
    addresses: (addresses ?? []) as Array<{
      id: string; label: string | null; full_name: string; phone: string; phone_alternate: string | null;
      governorate_id: number; area_id: number; address1: string; address2: string | null;
      postal_code: string | null; is_default: boolean; lat: number | null; lng: number | null; geo_accuracy: number | null;
    }>,
    governorates: (governorates ?? []) as Array<{ id: number; name_ar: string; name_en: string; shipping_fee_piastres: number; is_active: boolean }>,
    areas: (areas ?? []) as Array<{ id: number; governorate_id: number; name_ar: string; name_en: string; is_active: boolean }>,
    quote,
    kashier: isKashierConfigured(),
    attemptKey: crypto.randomUUID(),
    codCap: ((settingsRow?.value as { cod_max_total_piastres?: number } | null)?.cod_max_total_piastres) ?? 500000,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  const { viewer } = (await getViewer(client)) ?? { viewer: null };
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "place");

  if (!viewer) return data({ ok: false, reason: "auth_required" }, { status: 401 });

  /* ---- live re-quote (shipping fee + coupon + COD state) ---- */
  if (intent === "quote") {
    const govId = Number(form.get("governorate_id") ?? 0) || null;
    const coupon = (form.get("coupon_code") as string) || null;
    const quote = await loadCheckoutQuote(client, viewer.user.id, {
      governorateId: govId, areaId: null, couponCode: coupon,
    });
    return { ok: true, quote: JSON.parse(JSON.stringify(quote)) as CheckoutQuote };
  }

  /* ---- place the order: fn_create_order is the only authority ---- */
  if (intent === "place") {
    const method = String(form.get("payment_method") ?? "");
    if (method !== "kashier" && method !== "cod") {
      return data({ ok: false, reason: "bad_payment_method" }, { status: 400 });
    }
    if (method === "kashier" && !isKashierConfigured()) {
      return data({ ok: false, reason: "payment_unavailable" }, { status: 400 });
    }

    // address: saved id or an inline new one — phones validated with the same
    // normalizer the rest of the app uses, then E.164 into the snapshot
    const addressId = String(form.get("address_id") ?? "");
    let address: Record<string, unknown>;
    if (addressId) {
      const { data: saved } = await client
        .from("user_addresses")
        .select("full_name, phone, governorate_id, area_id, address1, address2, postal_code")
        .eq("id", addressId)
        .eq("user_id", viewer.user.id)
        .maybeSingle();
      if (!saved) return data({ ok: false, reason: "address_not_found" }, { status: 400 });
      address = { ...saved, phone_primary: saved.phone, phone_alternate: String(form.get("phone_alternate") ?? "") };
    } else {
      const primary = normalizeEgyptianPhone(String(form.get("phone_primary") ?? ""));
      const alternate = normalizeEgyptianPhone(String(form.get("phone_alternate") ?? ""));
      if (!primary.ok) return data({ ok: false, reason: "phone_primary_invalid" }, { status: 400 });
      if (!alternate.ok) return data({ ok: false, reason: "phone_alternate_invalid" }, { status: 400 });
      if (primary.e164 === alternate.e164) return data({ ok: false, reason: "phones_equal" }, { status: 400 });
      address = {
        full_name: String(form.get("full_name") ?? "").trim(),
        phone_primary: primary.e164,
        phone_alternate: alternate.e164,
        governorate_id: Number(form.get("governorate_id") ?? 0),
        area_id: Number(form.get("area_id") ?? 0),
        address1: String(form.get("address1") ?? "").trim(),
        address2: String(form.get("address2") ?? "").trim(),
        postal_code: String(form.get("postal_code") ?? "").trim(),
        // L-20 optional delivery pin (validated again inside fn_create_order)
        ...(form.get("lat") && form.get("lng")
          ? { lat: Number(form.get("lat")), lng: Number(form.get("lng")),
              ...(form.get("geo_accuracy") ? { geo_accuracy: Number(form.get("geo_accuracy")) } : {}) }
          : {}),
      };
      if (!address.full_name || !address.address1 || !address.governorate_id || !address.area_id) {
        return data({ ok: false, reason: "address_incomplete" }, { status: 400 });
      }
    }
    if (!address.phone_alternate) {
      return data({ ok: false, reason: "alternate_required" }, { status: 400 });
    }
    // saved-address mode still carries the optional pin chosen on the map
    if (form.get("lat") && form.get("lng")) {
      address.lat = Number(form.get("lat"));
      address.lng = Number(form.get("lng"));
      if (form.get("geo_accuracy")) address.geo_accuracy = Number(form.get("geo_accuracy"));
    }

    const attemptKey = String(form.get("attempt_key") ?? "");
    const couponCode = String(form.get("coupon_code") ?? "").trim();
    const { data: res, error } = await client.rpc("fn_create_order", {
      p_payload: {
        attempt_key: attemptKey || null,
        payment_method: method,
        coupon_code: couponCode || null,
        address,
      },
    });
    if (error) return data({ ok: false, reason: "server_error", detail: error.message }, { status: 500 });
    const r = res as { ok: boolean; reason?: string; number?: string; cap_piastres?: number; names?: string };
    if (!r.ok) {
      return data({ ok: false, reason: r.reason ?? "server_error", cap_piastres: r.cap_piastres, names: r.names }, { status: 400 });
    }

    // confirmation email for COD (Kashier's arrives with the webhook)
    if (method === "cod") {
      const admin = getSupabaseAdminClient();
      if (admin) void sendOrderEmail(admin, r.number!, "order_confirmation").catch(() => undefined);
    }

    if (method === "cod") {
      throw redirect(`/${lang}/order/${encodeURIComponent(r.number!)}?placed=1`);
    }
    // amount must match the created order — read it back
    const { data: created } = await client
      .from("orders").select("total_piastres").eq("number", r.number!).maybeSingle();
    const payUrl = created
      ? buildKashierCheckoutUrl({
          orderNumber: r.number!, totalPiastres: created.total_piastres,
          lang: lang === "en" ? "en" : "ar", siteUrl: getSiteUrl(request.url),
        })
      : null;
    if (!payUrl) return data({ ok: false, reason: "payment_session_failed" }, { status: 500 });
    throw redirect(payUrl);
  }

  return data({ ok: false, reason: "bad_intent" }, { status: 400 });
}

/* ============================== UI ============================== */

type Quote = CheckoutQuote | null;

const STEPS = ["address", "shipping", "payment", "confirm"] as const;
type Step = (typeof STEPS)[number];

export default function CheckoutPage({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const lang = loaderData.lang;
  const cart = useCart();
  const en = i18n.language?.startsWith("en");

  const [step, setStep] = useState<Step>("address");
  const [quote, setQuote] = useState<Quote>(loaderData.quote);
  const [placed, setPlaced] = useState(false);
  const quoteFetcher = useFetcher<typeof action>();
  const placeFetcher = useFetcher<typeof action>();

  // ---- address form state
  const [addressMode, setAddressMode] = useState<"saved" | "new">(
    loaderData.addresses.length > 0 ? "saved" : "new",
  );
  const defaultAddress = loaderData.addresses.find((a) => a.is_default) ?? loaderData.addresses[0];
  const [selectedAddressId, setSelectedAddressId] = useState<string>(defaultAddress?.id ?? "");
  // the SELECTED saved address (drives alternate-phone prefill + saved pin reuse)
  const selectedAddress = loaderData.addresses.find((a) => a.id === selectedAddressId) ?? defaultAddress;
  const [fullName, setFullName] = useState(defaultAddress?.full_name ?? "");
  const [primaryPhone, setPrimaryPhone] = useState(defaultAddress?.phone ?? loaderData.profilePhone);
  // H-21: prefilled from the saved address (or the profile for a new address)
  const [alternatePhone, setAlternatePhone] = useState("");
  const [pinDirty, setPinDirty] = useState(false);
  const [govId, setGovId] = useState<number | null>(defaultAddress?.governorate_id ?? null);
  const [areaId, setAreaId] = useState<number | null>(defaultAddress?.area_id ?? null);
  const [addr1, setAddr1] = useState(defaultAddress?.address1 ?? "");
  const [addr2, setAddr2] = useState(defaultAddress?.address2 ?? "");
  const [postal, setPostal] = useState(defaultAddress?.postal_code ?? "");
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // ---- delivery pin: H-23 — a saved address WITH a stored pin provides the
  // map's starting marker; the user may move/clear it (pinDirty = user edit)
  const [pin, setPin] = useState<PinValue | null>(null);
  const prefillFromPin = (street: string) => {
    if (addressMode === "new" && !addr1.trim()) {
      setAddr1((prev) => (prev.trim() ? prev : street));
    }
  };

  /* H-21/H-23 — when the selected saved address (or the mode) changes:
     - the alternate phone pre-fills from the saved address (user-editable;
       checkout still validates it server-side)
     - the map pin pre-fills from the address's stored pin unless the user
       already moved/cleared it manually (pinDirty) */
  useEffect(() => {
    if (addressMode === "saved") {
      setAlternatePhone(selectedAddress?.phone_alternate ?? "");
      if (!pinDirty) {
        setPin(
          selectedAddress && selectedAddress.lat != null && selectedAddress.lng != null
            ? { lat: selectedAddress.lat, lng: selectedAddress.lng, accuracyM: selectedAddress.geo_accuracy }
            : null,
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressMode, selectedAddressId]);

  /* H-21 — a NEW address starts from the profile's saved alternate phone. */
  useEffect(() => {
    if (addressMode === "new" && !alternatePhone) {
      setAlternatePhone(loaderData.profileAlternatePhone ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressMode]);

  // ---- coupon + payment
  const [couponInput, setCouponInput] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"kashier" | "cod" | null>(null);
  const [terms, setTerms] = useState(false);

  const activeGov = loaderData.governorates.find((g) => g.id === (addressMode === "saved" ? (selectedAddress?.governorate_id ?? null) : govId)) ?? null;

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
    if (loaderData.guest) return;
    const effGov = addressMode === "saved" ? (selectedAddress?.governorate_id ?? null) : govId;
    if (quotedGovRef.current !== effGov || quotedCouponRef.current !== couponCode) {
      quotedGovRef.current = effGov;
      quotedCouponRef.current = couponCode;
      quoteFor(effGov, couponCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaderData.guest, addressMode, govId, couponCode]);

  useEffect(() => {
    if (quoteFetcher.data && "quote" in quoteFetcher.data && quoteFetcher.data.quote) {
      setQuote(quoteFetcher.data.quote as CheckoutQuote);
    }
  }, [quoteFetcher.data]);

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

  const canPlace =
    !placed && sellable.length > 0 && paymentMethod !== null && terms &&
    (addressMode === "saved" ? selectedAddressId !== "" : true);

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

  type PlaceError = { ok: false; reason: string; cap_piastres?: number; names?: string };
  const placeError = placeFetcher.data && "reason" in placeFetcher.data
    ? (placeFetcher.data as unknown as PlaceError)
    : null;

  const err = (field: string): string | undefined => {
    if (!touched[field]) return undefined;
    switch (field) {
      case "full_name": return fullName.trim() ? undefined : t("checkout.errName");
      case "phone_primary": return primaryPhone.trim() ? (normalizeEgyptianPhone(primaryPhone).ok ? undefined : t("checkout.errPhone")) : t("checkout.errPhoneRequired");
      case "phone_alternate": {
        if (!alternatePhone.trim()) return t("checkout.errAlternateRequired");
        const a = normalizeEgyptianPhone(alternatePhone);
        if (!a.ok) return t("checkout.errPhone");
        const p = normalizeEgyptianPhone(primaryPhone);
        if (p.ok && a.e164 === p.e164) return t("checkout.errPhonesEqual");
        return undefined;
      }
      case "governorate": return govId ? undefined : t("checkout.errGovernorate");
      case "area": return areaId ? undefined : t("checkout.errArea");
      case "address1": return addr1.trim() ? undefined : t("checkout.errAddress1");
      default: return undefined;
    }
  };
  const blur = (field: string) => setTouched((s) => ({ ...s, [field]: true }));

  const addressDone = addressMode === "saved"
    ? selectedAddressId !== "" && err("phone_alternate") === undefined && Boolean(alternatePhone)
    : Boolean(fullName && addr1 && govId && areaId && alternatePhone && err("phone_primary") === undefined && err("phone_alternate") === undefined);

  const stepStates: Record<Step, { done: boolean; label: string; value: string }> = {
    address: {
      done: addressDone,
      label: t("checkout.stepAddress"),
      value: addressMode === "saved" && selectedAddress ? (selectedAddress.address1) : addr1,
    },
    shipping: { done: Boolean(activeGov) && addressDone, label: t("checkout.stepShipping"), value: activeGov ? (i18n.language?.startsWith("en") ? activeGov.name_en : activeGov.name_ar) : "" },
    payment: { done: paymentMethod !== null, label: t("checkout.stepPayment"), value: paymentMethod ? t(`checkout.pay_${paymentMethod}`) : "" },
    confirm: { done: false, label: t("checkout.stepConfirm"), value: "" },
  };

  const submitPlace = () => {
    const fd = new FormData();
    fd.set("intent", "place");
    fd.set("payment_method", paymentMethod ?? "");
    fd.set("attempt_key", loaderData.attemptKey);
    fd.set("coupon_code", couponCode);
    if (addressMode === "saved") {
      fd.set("address_id", selectedAddressId);
      fd.set("phone_alternate", alternatePhone);
    } else {
      fd.set("full_name", fullName);
      const p = normalizeEgyptianPhone(primaryPhone);
      fd.set("phone_primary", p.ok ? p.e164 : primaryPhone);
      const a = normalizeEgyptianPhone(alternatePhone);
      fd.set("phone_alternate", a.ok ? a.e164 : alternatePhone);
      fd.set("governorate_id", String(govId ?? ""));
      fd.set("area_id", String(areaId ?? ""));
      fd.set("address1", addr1);
      fd.set("address2", addr2);
      fd.set("postal_code", postal);
    }
    // the pin applies in BOTH address modes (checkout-level choice)
    if (pin) {
      fd.set("lat", String(pin.lat));
      fd.set("lng", String(pin.lng));
      if (pin.accuracyM != null) fd.set("geo_accuracy", String(pin.accuracyM));
    }
    setPlaced(true);
    placeFetcher.submit(fd, { method: "post", preventScrollReset: true });
    setTimeout(() => setPlaced(false), 8000);
  };

  const money = (p: number) =>
    new Intl.NumberFormat(i18n.language?.startsWith("en") ? "en-EG" : "ar-EG", { style: "currency", currency: "EGP", maximumFractionDigits: 2 }).format(p / 100);

  const stepHeader = (s: Step, index: number) => {
    const state = stepStates[s];
    const open = step === s;
    return (
      <button
        type="button"
        onClick={() => setStep(s)}
        aria-expanded={open}
        className={`flex w-full items-center justify-between gap-3 px-4 py-3.5 text-start transition-colors duration-150 ${open ? "bg-surface-tint" : "hover:bg-surface-tint"}`}
      >
        <span className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className={`flex size-7 shrink-0 items-center justify-center rounded-full border text-sm font-extrabold ${
              open ? "border-action bg-action text-on-action" : state.done ? "border-action text-action" : "border-border text-text-faint"
            }`}
          >
            {index + 1}
          </span>
          <span>
            <span className="block text-sm font-bold text-text">
              {state.label}
              <span className="sr-only"> — {t("checkout.stepOf", { current: index + 1, total: STEPS.length })}</span>
            </span>
            {!open && state.value ? (
              <span className="block truncate text-xs text-text-faint">{state.value}</span>
            ) : null}
          </span>
        </span>
        <span className="text-xs font-bold text-text-faint">{t("checkout.stepOf", { current: index + 1, total: STEPS.length })}</span>
      </button>
    );
  };

  return (
    <div className="mx-auto w-full max-w-page px-4 py-6">
      <h1 className="mb-1 text-lg font-extrabold text-text">{t("checkout.title")}</h1>
      <p className="mb-4 text-sm text-text-muted">{t("checkout.subtitle")}</p>

      {placeError ? (
        <div
          id="checkout-error-summary"
          role="alert"
          tabIndex={-1}
          className="mb-4 rounded-md border border-danger bg-surface p-4 outline-none"
        >
          <p className="text-sm font-bold text-danger">{t("checkout.placeFailed")}</p>
          <p className="mt-1 text-sm text-text-muted">
            {placeError.reason === "cod_cap" && t("checkout.codCapReason", { cap: money(placeError.cap_piastres ?? loaderData.codCap) })}
            {placeError.reason === "cod_vendor_ship" && t("checkout.codVendorShipReason")}
            {placeError.reason === "items_unavailable" && t("checkout.itemsUnavailable", { names: placeError.names ?? "" })}
            {placeError.reason === "insufficient_stock" && t("checkout.stockChanged")}
            {placeError.reason === "phones_equal" && t("checkout.errPhonesEqual")}
            {placeError.reason === "phone_invalid" && t("checkout.errPhone")}
            {placeError.reason === "address_incomplete" && t("checkout.errAddress1")}
            {placeError.reason === "area_unavailable" && t("checkout.errArea")}
            {placeError.reason === "coupon_expired" && t("cart.coupon.error.expired")}
            {placeError.reason === "coupon_limit" && t("cart.coupon.error.limit")}
            {placeError.reason === "coupon_min_subtotal" && t("cart.coupon.error.min_subtotal")}
            {placeError.reason === "coupon_invalid" && t("cart.coupon.error.not_eligible")}
            {placeError.reason === "payment_unavailable" && t("checkout.payUnavailable")}
            {placeError.reason === "duplicate" && t("checkout.duplicateAttempt")}
            {!["cod_cap", "cod_vendor_ship", "items_unavailable", "insufficient_stock", "phones_equal", "phone_invalid", "address_incomplete", "area_unavailable", "coupon_expired", "coupon_limit", "coupon_min_subtotal", "coupon_invalid", "payment_unavailable", "duplicate"].includes(placeError.reason) && t("checkout.genericError")}
          </p>
          <p className="mt-2 text-sm">
            <Link to={`/${lang}/cart`} className="font-bold text-action hover:underline">{t("checkout.backToCart")}</Link>
          </p>
        </div>
      ) : null}

      {quote && quote.blockedNames.length > 0 ? (
        <div role="status" className="mb-4 rounded-md border border-border bg-surface p-4">
          <p className="text-sm font-bold text-text">{t("checkout.unavailableTitle")}</p>
          <p className="mt-1 text-sm text-text-muted">{t("checkout.unavailableBody", { names: quote.blockedNames.join("، ") })}</p>
          <Link to={`/${lang}/cart`} className="mt-2 inline-block text-sm font-bold text-action hover:underline">
            {t("checkout.reviewCart")}
          </Link>
        </div>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_360px]">
        {/* ---------------- accordion ---------------- */}
        <div className="flex flex-col gap-3">
          {/* Step 1 — account & address */}
          <section className="overflow-hidden rounded-md border border-border bg-surface">
            {stepHeader("address", 0)}
            {step === "address" ? (
              <div className="border-t border-border p-4">
                {/* email: displayed read-only, never an input (AGENT §29) */}
                <div className="mb-4 rounded-md bg-surface-tint p-3">
                  <p className="text-sm font-bold text-text">{t("checkout.emailLabel")}</p>
                  <p className="text-sm text-text-muted">{loaderData.viewerEmail}</p>
                  <p className="mt-1 text-xs text-text-faint">{t("checkout.emailReadOnly")}</p>
                </div>

                {loaderData.addresses.length > 0 ? (
                  <fieldset className="mb-4">
                    <legend className="mb-2 text-sm font-bold text-text">{t("checkout.savedAddresses")}</legend>
                    <div className="flex flex-col gap-2">
                      {loaderData.addresses.map((a) => (
                        <label
                          key={a.id}
                          className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors duration-150 ${
                            addressMode === "saved" && selectedAddressId === a.id ? "border-action bg-surface-tint" : "border-border hover:border-primary"
                          }`}
                        >
                          <input
                            type="radio"
                            name="saved-address"
                            className="mt-1 size-4 accent-[var(--color-action)]"
                            checked={addressMode === "saved" && selectedAddressId === a.id}
                            onChange={() => { setAddressMode("saved"); setSelectedAddressId(a.id); setPinDirty(false); }}
                          />
                          <span className="text-sm">
                            <span className="font-bold text-text">
                              {a.full_name}
                              {a.is_default ? <span className="ms-2 rounded-md bg-surface-tint px-1.5 py-0.5 text-2xs font-bold text-text-muted">{t("checkout.defaultAddress")}</span> : null}
                            </span>
                            <span className="mt-0.5 block text-sm text-text-muted" dir="ltr">
                              {a.phone}
                            </span>
                            <span className="mt-0.5 block text-sm text-text-muted">
                              {a.address1}{a.address2 ? `، ${a.address2}` : ""}
                              {` — ${loaderData.governorates.find((g) => g.id === a.governorate_id)?.[i18n.language?.startsWith("en") ? "name_en" : "name_ar"] ?? ""} · ${loaderData.areas.find((x) => x.id === a.area_id)?.[i18n.language?.startsWith("en") ? "name_en" : "name_ar"] ?? ""}`}
                            </span>
                          </span>
                        </label>
                      ))}
                      <label className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 transition-colors duration-150 ${addressMode === "new" ? "border-action bg-surface-tint" : "border-border hover:border-primary"}`}>
                        <input
                          type="radio"
                          name="saved-address"
                          className="size-4 accent-[var(--color-action)]"
                          checked={addressMode === "new"}
                          onChange={() => { setAddressMode("new"); setPinDirty(false); }}
                        />
                        <span className="text-sm font-bold text-text">{t("checkout.newAddress")}</span>
                      </label>
                    </div>
                  </fieldset>
                ) : null}

                {addressMode === "new" ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input
                      id="ck-name" label={t("checkout.fullName")} required
                      value={fullName} onChange={(e) => setFullName(e.target.value)}
                      onBlur={() => blur("full_name")} error={err("full_name")}
                      autoComplete="name"
                    />
                    <Input
                      id="ck-phone1" label={t("checkout.primaryPhone")} required type="tel" inputMode="tel" dir="ltr"
                      value={primaryPhone} onChange={(e) => setPrimaryPhone(e.target.value)}
                      onBlur={() => blur("phone_primary")} error={err("phone_primary")}
                      hint={t("checkout.phoneHint")} autoComplete="tel"
                    />
                    <Input
                      id="ck-phone2" label={t("checkout.alternatePhone")} required type="tel" inputMode="tel" dir="ltr"
                      value={alternatePhone} onChange={(e) => setAlternatePhone(e.target.value)}
                      onBlur={() => blur("phone_alternate")} error={err("phone_alternate")}
                      hint={t("checkout.alternateHint")}
                    />
                    {/* H-22: governorate→area dependent (abort + session cache);
                        the pair is re-verified on the server inside the action */}
                    <div className="sm:col-span-2">
                      <GovernateAreaSelects
                        lang={lang}
                        governorates={loaderData.governorates}
                        governorateId={govId ? String(govId) : ""}
                        areaId={areaId ? String(areaId) : ""}
                        onGovernorateChange={(v) => {
                          setGovId(v ? Number(v) : null);
                          setAreaId(null);
                          blur("governorate");
                        }}
                        onAreaChange={(v) => { setAreaId(v ? Number(v) : null); blur("area"); }}
                        initialAreas={loaderData.areas}
                        govError={err("governorate")}
                        areaError={err("area")}
                      />
                    </div>
                    <Input
                      id="ck-addr1" label={t("checkout.address1")} required className="sm:col-span-2"
                      value={addr1} onChange={(e) => setAddr1(e.target.value)}
                      onBlur={() => blur("address1")} error={err("address1")}
                      autoComplete="address-line1"
                    />
                    <Input
                      id="ck-addr2" label={`${t("checkout.address2")} (${t("checkout.optional")})`}
                      value={addr2} onChange={(e) => setAddr2(e.target.value)}
                      autoComplete="address-line2"
                    />
                    <Input
                      id="ck-postal" label={`${t("checkout.postal")} (${t("checkout.optional")})`}
                      value={postal} onChange={(e) => setPostal(e.target.value)}
                      inputMode="numeric"
                    />
                  </div>
                ) : null}

                {/* L-20/H-23 — optional delivery pin (both address modes).
                    A saved address with a stored pin pre-places the marker. */}
                <div className="mt-3">
                  <p className="mb-1.5 text-sm font-bold text-text">
                    {t("map.title")} <span className="font-normal text-text-faint">({t("checkout.optional")})</span>
                  </p>
                  <LocationPicker value={pin} onChange={(v) => { setPinDirty(true); setPin(v); }} onStreet={prefillFromPin} />
                </div>

                {/* alternate phone is required even for saved addresses */}
                {addressMode === "saved" ? (
                  <div className="mt-1 max-w-sm">
                    <Input
                      id="ck-phone2-saved" label={t("checkout.alternatePhone")} required type="tel" inputMode="tel" dir="ltr"
                      value={alternatePhone} onChange={(e) => setAlternatePhone(e.target.value)}
                      onBlur={() => blur("phone_alternate")} error={err("phone_alternate")}
                      hint={t("checkout.alternateHint")}
                    />
                  </div>
                ) : null}

                <div className="mt-4 flex justify-end">
                  <Button
                    onClick={() => {
                      setTouched({ full_name: true, phone_primary: true, phone_alternate: true, governorate: true, area: true, address1: true });
                      const pNorm = normalizeEgyptianPhone(primaryPhone);
                      const aNorm = normalizeEgyptianPhone(alternatePhone);
                      const valid =
                        addressMode === "saved"
                          ? selectedAddressId !== "" && pNorm.ok && aNorm.ok && pNorm.e164 !== aNorm.e164
                          : Boolean(fullName && addr1 && govId && areaId && err("phone_primary") === undefined && err("phone_alternate") === undefined);
                      if (valid) setStep("shipping");
                    }}
                  >
                    {t("checkout.continue")}
                  </Button>
                </div>
              </div>
            ) : null}
          </section>

          {/* Step 2 — shipping */}
          <section className="overflow-hidden rounded-md border border-border bg-surface">
            {stepHeader("shipping", 1)}
            {step === "shipping" ? (
              <div className="border-t border-border p-4">
                {activeGov ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between rounded-md bg-surface-tint p-3">
                      <span className="text-sm font-bold text-text">{t("checkout.shippingFee")}</span>
                      <span className="text-sm font-extrabold text-text">
                        {totals?.free_shipping ? t("checkout.freeShipping") : money(totals?.shipping_piastres ?? activeGov.shipping_fee_piastres)}
                      </span>
                    </div>
                    {totals?.free_shipping ? (
                      <p className="text-sm text-text-muted">{t("checkout.freeShippingCoupon", { code: couponCode })}</p>
                    ) : null}
                    <p className="text-sm text-text-muted">{t("checkout.shippingNotice")}</p>
                  </div>
                ) : (
                  <p className="text-sm text-text-muted">{t("checkout.chooseGovernorateFirst")}</p>
                )}
                <div className="mt-4 flex justify-between">
                  <Button variant="ghost" onClick={() => setStep("address")}>{t("checkout.back")}</Button>
                  <Button onClick={() => setStep("payment")}>{t("checkout.continue")}</Button>
                </div>
              </div>
            ) : null}
          </section>

          {/* Step 3 — payment */}
          <section className="overflow-hidden rounded-md border border-border bg-surface">
            {stepHeader("payment", 2)}
            {step === "payment" ? (
              <div className="border-t border-border p-4">
                <div role="radiogroup" aria-label={t("checkout.stepPayment")} className="flex flex-col gap-2">
                  <label className={`flex cursor-pointer items-start gap-3 rounded-md border p-3.5 transition-colors duration-150 ${
                    paymentMethod === "kashier" ? "border-action bg-surface-tint" : "border-border hover:border-primary"
                  } ${loaderData.kashier ? "" : "opacity-60"}`}>
                    <input
                      type="radio"
                      name="payment"
                      className="mt-1 size-4 accent-[var(--color-action)]"
                      disabled={!loaderData.kashier}
                      checked={paymentMethod === "kashier"}
                      onChange={() => setPaymentMethod("kashier")}
                    />
                    <span className="text-sm">
                      <span className="block font-bold text-text">{t("checkout.pay_kashier")}</span>
                      <span className="block text-sm text-text-muted">{t("checkout.payKashierDesc")}</span>
                      {!loaderData.kashier ? <span className="mt-1 block text-xs text-danger">{t("checkout.payUnavailable")}</span> : null}
                    </span>
                  </label>

                  <label className={`flex items-start gap-3 rounded-md border p-3.5 transition-colors duration-150 ${
                    paymentMethod === "cod" ? "border-action bg-surface-tint" : "border-border"
                  } ${codState.allowed ? "cursor-pointer hover:border-primary" : "opacity-60"}`}>
                    <input
                      type="radio"
                      name="payment"
                      className="mt-1 size-4 accent-[var(--color-action)]"
                      disabled={!codState.allowed}
                      checked={paymentMethod === "cod"}
                      onChange={() => setPaymentMethod("cod")}
                    />
                    <span className="text-sm">
                      <span className="block font-bold text-text">{t("checkout.pay_cod")}</span>
                      <span className="block text-sm text-text-muted">{t("checkout.payCodDesc")}</span>
                      {!codState.allowed ? (
                        <span className="mt-1 block text-xs text-danger">
                          {codState.reason === "cap"
                            ? t("checkout.codCapReason", { cap: money(codState.cap_piastres) })
                            : t("checkout.codVendorShipReason")}
                        </span>
                      ) : null}
                    </span>
                  </label>
                </div>
                <div className="mt-4 flex justify-between">
                  <Button variant="ghost" onClick={() => setStep("shipping")}>{t("checkout.back")}</Button>
                  <Button onClick={() => setStep("confirm")}>{t("checkout.continue")}</Button>
                </div>
              </div>
            ) : null}
          </section>

          {/* Step 4 — confirm */}
          <section className="overflow-hidden rounded-md border border-border bg-surface">
            {stepHeader("confirm", 3)}
            {step === "confirm" ? (
              <div className="border-t border-border p-4">
                <p className="text-sm text-text-muted">
                  {t("checkout.confirmSummary", {
                    address: addressMode === "saved" ? `${defaultAddress?.full_name ?? ""} — ${defaultAddress?.address1 ?? ""}` : `${fullName} — ${addr1}`,
                    payment: paymentMethod ? t(`checkout.pay_${paymentMethod}`) : "—",
                  })}
                </p>
                <label className="mt-3 flex items-start gap-2 text-sm text-text">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-[var(--color-action)]"
                    checked={terms}
                    onChange={(e) => setTerms(e.target.checked)}
                  />
                  <span>
                    {t("checkout.termsPrefix")}{" "}
                    <Link to={`/${lang}/p/terms`} className="font-bold text-action hover:underline">{t("checkout.termsLink")}</Link>
                    {" · "}
                    <Link to={`/${lang}/p/returns`} className="font-bold text-action hover:underline">{t("checkout.returnsLink")}</Link>
                  </span>
                </label>
                <div className="mt-4 flex justify-between">
                  <Button variant="ghost" onClick={() => setStep("payment")}>{t("checkout.back")}</Button>
                  <Button size="lg" disabled={!canPlace} loading={placeFetcher.state !== "idle"} onClick={submitPlace}>
                    {t("checkout.placeOrder")}
                  </Button>
                </div>
              </div>
            ) : null}
          </section>
        </div>

        {/* ---------------- sticky summary ---------------- */}
        <aside className="lg:sticky lg:top-24">
          <div className="rounded-md border border-border bg-surface p-4">
            <h2 className="text-sm font-extrabold text-text">{t("checkout.summaryTitle")}</h2>
            {groups.length === 0 ? (
              <p className="mt-3 text-sm text-text-muted">{t("cart.empty")}</p>
            ) : (
              groups.map(([vendorId, lines]) => (
                <div key={vendorId} className="mt-3">
                  <p className="text-xs font-bold text-text-muted">
                    {i18n.language?.startsWith("en") ? lines[0]?.store_name_en : lines[0]?.store_name_ar}
                  </p>
                  <ul className="mt-1.5 flex flex-col gap-2">
                    {lines.map((l) => (
                      <li key={l.variant_id} className="flex items-center gap-2.5">
                        <MediaImg
                          path={l.image_path ?? ""}
                          alt={i18n.language?.startsWith("en") ? l.name_en : l.name_ar}
                          className="size-11 shrink-0 rounded-md border border-border object-cover"
                        />
                        <span className="min-w-0 flex-1">
                          <Link to={`/${lang}/product/${encodeURIComponent(i18n.language?.startsWith("en") ? l.slug_en : l.slug_ar)}`} className="block truncate text-sm font-bold text-text hover:text-action">
                            {i18n.language?.startsWith("en") ? l.name_en : l.name_ar}
                          </Link>
                          <span className="text-xs text-text-muted">
                            {l.option_key ? `${l.option_key} · ` : ""}{t("cart.qty")} {l.qty}
                          </span>
                        </span>
                        <span className="text-sm font-extrabold text-text">{money(l.unit_piastres * l.qty)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}

            {/* coupon */}
            <div className="mt-4 border-t border-border pt-3">
              <label htmlFor="ck-coupon" className="text-sm font-bold text-text">{t("cart.coupon.label")}</label>
              <div className="mt-1.5 flex gap-2">
                <input
                  id="ck-coupon"
                  value={couponInput}
                  onChange={(e) => setCouponInput(e.target.value)}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none transition-colors duration-150 focus:border-primary focus:shadow-focus"
                  placeholder={t("cart.coupon.placeholder")}
                />
                <Button
                  variant="outline" size="sm"
                  disabled={!couponInput.trim() || quoteFetcher.state !== "idle"}
                  onClick={() => setCouponCode(couponInput.trim())}
                >
                  {t("cart.coupon.apply")}
                </Button>
              </div>
              {totals && !totals.coupon.ok && totals.coupon.code ? (
                <p className="mt-1.5 text-xs text-danger">
                  {totals.coupon.reason === "expired" ? t("cart.coupon.error.expired")
                    : totals.coupon.reason === "limit" ? t("cart.coupon.error.limit")
                    : totals.coupon.reason === "min_subtotal" ? t("cart.coupon.error.min_subtotal")
                    : t("cart.coupon.error.not_eligible")}
                </p>
              ) : null}
              {totals && totals.coupon.ok && totals.coupon.code ? (
                <p className="mt-1.5 text-xs text-primary">{t("cart.coupon.appliedCode", { code: totals.coupon.code })}</p>
              ) : null}
            </div>

            {/* totals */}
            <dl className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-text-muted">{t("cart.subtotal")}</dt>
                <dd className="font-bold text-text">{money(totals?.subtotal_piastres ?? 0)}</dd>
              </div>
              {(totals?.discount_piastres ?? 0) > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-text-muted">{t("cart.discount")}</dt>
                  <dd className="font-bold text-primary">−{money(totals!.discount_piastres)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between">
                <dt className="text-text-muted">{t("cart.shipping")}</dt>
                <dd className="font-bold text-text">
                  {totals?.free_shipping ? t("checkout.freeShipping") : money(totals?.shipping_piastres ?? 0)}
                </dd>
              </div>
              <div className="mt-1 flex justify-between border-t border-border pt-2">
                <dt className="text-sm font-extrabold text-text">{t("cart.total")}</dt>
                <dd className="text-base font-extrabold text-text">{money(totals?.total_piastres ?? 0)}</dd>
              </div>
            </dl>
            <p className="mt-2 text-2xs text-text-faint">{t("checkout.totalServerSide")}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}


/** SSR-safe shared map lives in ~/components/location/LocationPicker (H-23). */

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonPage />;
}
