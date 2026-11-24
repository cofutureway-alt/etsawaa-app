import { data, redirect } from "react-router";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { getSupabaseAdminClient } from "~/lib/supabase/admin";
import { getViewer, requireLegalAccepted } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { getSiteUrl } from "~/lib/env.server";
import { normalizeEgyptianPhone } from "~/lib/phone";
import { loadCheckoutQuote, loadCodSettings, type CheckoutQuote } from "~/features/checkout/pricing.server";
import { loadKashierSettings, resolveKashierMode, startKashierPayment } from "~/features/checkout/kashier.server";
import { sendOrderEmail } from "~/features/orders/emails.server";
import { codesAvailable, isPhoneVerified } from "~/lib/messaging/otp.server";
import { rememberLocale } from "~/lib/locale-preference.server";
import type { CheckoutAddressRow, CheckoutAreaRow, CheckoutGovernorateRow } from "~/features/checkout/types";

/**
 * Server bodies for the checkout route (JOURNEYS §6). Extracted from
 * `app/routes/checkout.tsx` so the route module only keeps the React Router
 * exports; the behaviour is unchanged.
 *
 * The loader returns everything the accordion needs: viewer/profile prefill,
 * saved addresses, governorates + areas, a display-only price quote
 * (`loadCheckoutQuote` — fn_create_order remains the sole pricing authority)
 * and the Kashier availability + a fresh idempotency attempt key.
 *
 * The action has two intents: `quote` (live shipping-fee/coupon/COD re-quote)
 * and `place` (delegates entirely to `fn_create_order`, which re-validates and
 * re-prices everything — forged requests fail there).
 */

/**
 * Loader body for `app/routes/checkout.tsx`. Guests get the empty shell (the
 * page renders the signup gate); signed-in users get the full checkout data.
 */
export async function loadCheckoutPage(request: Request, params: { lang?: string }) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  const { viewer } = (await getViewer(client)) ?? { viewer: null };
  // a signed-in buyer must have accepted the current Terms before buying
  if (viewer) await requireLegalAccepted(client, lang, request);

  const [{ data: governorates }, { data: areas }] = await Promise.all([
    client.from("governorates").select("id, name_ar, name_en, shipping_fee_piastres, is_active").eq("is_active", true).order("sort"),
    client.from("areas").select("id, governorate_id, name_ar, name_en, is_active").eq("is_active", true).order("sort"),
  ]);

  if (!viewer) {
    return {
      lang, guest: true as const, viewerEmail: "", profilePhone: "", profileAlternatePhone: "",
      addresses: [] as CheckoutAddressRow[],
      governorates: [] as CheckoutGovernorateRow[],
      areas: [] as CheckoutAreaRow[],
      quote: null, kashier: resolveKashierMode(await loadKashierSettings(client), null) !== null, kashierTest: false, attemptKey: "",
      codCap: 500000,
    };
  }

  const kashierMode = resolveKashierMode(await loadKashierSettings(client), viewer.profile.role);
  const [{ data: addresses }, codSettings] = await Promise.all([
    client.from("user_addresses")
      .select("id, label, full_name, phone, phone_alternate, governorate_id, area_id, address1, address2, postal_code, is_default, lat, lng, geo_accuracy")
      .eq("user_id", viewer.user.id)
      .order("is_default", { ascending: false })
      .order("created_at"),
    loadCodSettings(client),
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
    addresses: (addresses ?? []) as CheckoutAddressRow[],
    governorates: (governorates ?? []) as CheckoutGovernorateRow[],
    areas: (areas ?? []) as CheckoutAreaRow[],
    quote,
    kashier: kashierMode !== null,
    kashierTest: kashierMode === "test",
    attemptKey: crypto.randomUUID(),
    codCap: codSettings.cap,
  };
}

/**
 * Action body for `app/routes/checkout.tsx`. Returns JSON for fetcher-driven
 * failures; successful COD placements redirect to the order page and Kashier
 * placements redirect to the hosted payment URL.
 */
export async function checkoutAction(request: Request, params: { lang?: string }) {
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
    const { data: legal } = await client.rpc("fn_legal_status");
    if ((legal as { terms?: { accepted?: boolean } } | null)?.terms?.accepted === false) {
      return data({ ok: false, reason: "terms_required" }, { status: 403 });
    }
    const method = String(form.get("payment_method") ?? "");
    if (method !== "kashier" && method !== "cod") {
      return data({ ok: false, reason: "bad_payment_method" }, { status: 400 });
    }
    const kashierSettings = await loadKashierSettings(client);
    const kashierMode = resolveKashierMode(kashierSettings, viewer.profile.role);
    if (method === "kashier" && !kashierMode) {
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

    // the shipping number is proven once by a code (only while codes can be sent)
    const codeAdmin = getSupabaseAdminClient();
    const primaryPhone = String(address.phone_primary ?? "");
    if (codeAdmin && primaryPhone && (await codesAvailable(codeAdmin, "checkout")) && !(await isPhoneVerified(codeAdmin, viewer.user.id, primaryPhone))) {
      return data({ ok: false, reason: "phone_unverified", phone: primaryPhone }, { status: 409 });
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
      await rememberLocale(client, lang);
      if (admin) void sendOrderEmail(admin, r.number!, "order_confirmation", lang).catch(() => undefined);
    }

    if (method === "cod") {
      throw redirect(`/${lang}/order/${encodeURIComponent(r.number!)}?placed=1`);
    }
    // amount must match the created order — read it back
    const { data: created } = await client
      .from("orders").select("total_piastres").eq("number", r.number!).maybeSingle();
    const admin = getSupabaseAdminClient();
    if (!created || !admin || !kashierMode) return data({ ok: false, reason: "payment_session_failed" }, { status: 500 });
    const session = await startKashierPayment(admin, "order", {
      mode: kashierMode,
      orderNumber: r.number!, totalPiastres: created.total_piastres,
      lang: lang === "en" ? "en" : "ar", siteUrl: getSiteUrl(request.url),
      customer: { email: viewer.user.email ?? "", reference: viewer.user.id },
      methods: kashierSettings.methods,
    });
    if (!session.ok) return data({ ok: false, reason: "payment_session_failed" }, { status: 502 });
    throw redirect(session.sessionUrl);
  }

  return data({ ok: false, reason: "bad_intent" }, { status: 400 });
}
