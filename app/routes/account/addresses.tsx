import { data, useFetcher } from "react-router";
import type { Route } from "./+types/addresses";
import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { normalizeEgyptianPhone } from "~/lib/phone";
import { Input } from "~/components/ui/Input";
import { Button } from "~/components/ui/Button";
import { Dialog } from "~/components/ui/Overlay";
import { Badge } from "~/components/ui/Badge";
import { EmptyState } from "~/components/ui/EmptyState";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { PencilIcon, PinIcon, TrashIcon, TruckIcon } from "~/components/ui/icons";
import { GovernateAreaSelects } from "~/components/location/GovernateAreaSelects";
import { LocationPicker } from "~/components/location/LocationPicker";
import type { PinValue } from "~/components/checkout/MapPin";
import { SkeletonPage } from "~/components/ui/Skeleton";


/**
 * Account addresses — H-01 card grid, H-21 prefill from profiles, H-22
 * governorate→area dependent fetch, H-23 optional saved map pin:
 *  - the add-form ONCE initializes اسم المستلم/الهاتف الأساسي/الاحتياطي from
 *    the profile (SSR data — never an empty flash; the route itself renders a
 *    page skeleton while navigating so no blank form exists)
 *  - the alternate phone is visible, labeled "required for shipping", with
 *    inline validation (must be valid and differ from the primary)
 *  - areas load per governorate on demand (abort + session cache)
 *  - the pin (lat/lng/accuracy) is optional, saved on the address, shown on
 *    the card, removable/editable; checkout reuses it automatically
 *  - the server still validates the governorate/area pair and the pin bounds
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "account", request);
  const [{ data: addresses }, { data: governorates }, { data: areas }] = await Promise.all([
    client.from("user_addresses").select("*").eq("user_id", viewer.user.id).order("is_default", { ascending: false }).order("created_at"),
    client.from("governorates").select("id, name_ar, name_en").eq("is_active", true).order("sort"),
    // initial payload only SEEDS the client session cache (first pick needs no
    // round-trip); per-governorate fetches go through /:lang/api/areas
    client.from("areas").select("id, governorate_id, name_ar, name_en").eq("is_active", true).order("sort"),
  ]);
  return {
    lang,
    addresses: JSON.parse(JSON.stringify(addresses ?? [])),
    governorates: governorates ?? [],
    areas: areas ?? [],
    profile: {
      full_name: viewer.profile.full_name ?? "",
      phone: viewer.profile.phone ?? "",
      phone_alternate: viewer.profile.phone_alternate ?? "",
      email: viewer.user.email ?? "",
    },
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "account", request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "delete") {
    const { error } = await client
      .from("user_addresses")
      .delete()
      .eq("id", String(form.get("id") ?? ""))
      .eq("user_id", viewer.user.id);
    return error ? data({ ok: false, reason: "failed" }, { status: 400 }) : { ok: true as const };
  }

  if (intent === "default") {
    const id = String(form.get("id") ?? "");
    await client.from("user_addresses").update({ is_default: false }).eq("user_id", viewer.user.id);
    const { error } = await client
      .from("user_addresses")
      .update({ is_default: true })
      .eq("id", id)
      .eq("user_id", viewer.user.id);
    return error ? data({ ok: false, reason: "failed" }, { status: 400 }) : { ok: true as const };
  }

  if (intent === "save") {
    const id = String(form.get("id") ?? "");
    const primary = normalizeEgyptianPhone(String(form.get("phone") ?? ""));
    if (!primary.ok) return data({ ok: false, reason: "phone" }, { status: 400 });
    // H-21: alternate phone is REQUIRED for shipping; validated as strictly as
    // the primary and must differ from it (same rule checkout enforces)
    const alternate = normalizeEgyptianPhone(String(form.get("phone_alternate") ?? ""));
    if (!alternate.ok) return data({ ok: false, reason: "alternate" }, { status: 400 });
    if (alternate.e164 === primary.e164) return data({ ok: false, reason: "phones_equal" }, { status: 400 });
    const governorateId = Number(form.get("governorate_id") ?? 0);
    const areaId = Number(form.get("area_id") ?? 0);
    // area must belong to the chosen governorate (composite FK backs this too)
    const { data: area } = await client
      .from("areas").select("id, governorate_id").eq("id", areaId).eq("governorate_id", governorateId).maybeSingle();
    if (!area) return data({ ok: false, reason: "area" }, { status: 400 });
    // H-23: optional pin — complete-or-absent, Egypt bounds (mirrors the DB check)
    const latRaw = String(form.get("lat") ?? "").trim();
    const lngRaw = String(form.get("lng") ?? "").trim();
    let pin: { lat: number; lng: number; geo_accuracy: number | null } | { lat: null; lng: null; geo_accuracy: null };
    if (latRaw && lngRaw) {
      const lat = Number(latRaw);
      const lng = Number(lngRaw);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 22 || lat > 32.5 || lng < 24 || lng > 37.5) {
        return data({ ok: false, reason: "pin" }, { status: 400 });
      }
      const accRaw = String(form.get("geo_accuracy") ?? "").trim();
      const acc = accRaw ? Number(accRaw) : null;
      pin = { lat, lng, geo_accuracy: acc && Number.isFinite(acc) && acc >= 1 && acc <= 5000 ? Math.round(acc) : null };
    } else {
      pin = { lat: null, lng: null, geo_accuracy: null };
    }
    const payload = {
      label: String(form.get("label") ?? "") || null,
      full_name: String(form.get("full_name") ?? "").trim(),
      phone: primary.e164,
      phone_alternate: alternate.e164,
      governorate_id: governorateId,
      area_id: areaId,
      address1: String(form.get("address1") ?? "").trim(),
      address2: String(form.get("address2") ?? "") || null,
      postal_code: String(form.get("postal_code") ?? "") || null,
      ...pin,
    };
    if (!payload.full_name || !payload.address1) return data({ ok: false, reason: "incomplete" }, { status: 400 });
    const makeDefault = form.get("is_default") === "on";
    if (makeDefault) {
      await client.from("user_addresses").update({ is_default: false }).eq("user_id", viewer.user.id);
    }
    const row = { ...payload, is_default: makeDefault };
    const { error } = id
      ? await client.from("user_addresses").update(row).eq("id", id).eq("user_id", viewer.user.id)
      : await client.from("user_addresses").insert({ ...row, user_id: viewer.user.id });
    return error ? data({ ok: false, reason: "failed" }, { status: 400 }) : { ok: true as const };
  }

  return data({ ok: false, reason: "bad_intent" }, { status: 400 });
}

type Address = {
  id: string; label: string | null; full_name: string; phone: string; phone_alternate: string | null;
  governorate_id: number; area_id: number; address1: string; address2: string | null;
  postal_code: string | null; is_default: boolean;
  lat: number | null; lng: number | null; geo_accuracy: number | null;
};
type Gov = { id: number; name_ar: string; name_en: string };
type Area = { id: number; governorate_id: number; name_ar: string; name_en: string };
type Form = {
  id: string; label: string; full_name: string; phone: string; phone_alternate: string;
  governorate_id: string; area_id: string; address1: string; address2: string;
  postal_code: string; is_default: boolean;
};
const EMPTY_FORM: Form = {
  id: "", label: "", full_name: "", phone: "", phone_alternate: "",
  governorate_id: "", area_id: "", address1: "", address2: "",
  postal_code: "", is_default: false,
};

export default function AccountAddressesPage({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  const [dialog, setDialog] = useState<{ open: boolean; form: Form }>({ open: false, form: EMPTY_FORM });
  const [pin, setPin] = useState<PinValue | null>(null);

  const govName = (id: number) => {
    const g = (loaderData.governorates as Gov[]).find((x) => x.id === id);
    return g ? (en ? g.name_en : g.name_ar) : "—";
  };
  const areaName = (id: number) => {
    const a = (loaderData.areas as Area[]).find((x) => x.id === id);
    return a ? (en ? a.name_en : a.name_ar) : "—";
  };

  // H-21: the ADD form opens pre-filled from the PROFILE (initialized once —
  // the user may overwrite any field; it does not re-flash to empty)
  const openAdd = () => {
    setDialog({
      open: true,
      form: {
        ...EMPTY_FORM,
        full_name: loaderData.profile.full_name,
        phone: loaderData.profile.phone,
        phone_alternate: loaderData.profile.phone_alternate,
      },
    });
    setPin(null);
  };
  const openEdit = (a: Address) => {
    setDialog({
      open: true,
      form: {
        id: a.id, label: a.label ?? "", full_name: a.full_name, phone: a.phone,
        phone_alternate: a.phone_alternate ?? "",
        governorate_id: String(a.governorate_id), area_id: String(a.area_id),
        address1: a.address1, address2: a.address2 ?? "", postal_code: a.postal_code ?? "",
        is_default: a.is_default,
      },
    });
    setPin(a.lat != null && a.lng != null ? { lat: a.lat, lng: a.lng, accuracyM: a.geo_accuracy } : null);
  };

  const form = dialog.form;
  const set = (k: keyof Form, v: string | boolean) =>
    setDialog((d) => ({ ...d, form: { ...d.form, [k]: v } }));
  // governorate change clears the area — a stale area from another governorate
  // would fail the server-side pair check anyway (H-22)
  const onGov = (v: string) =>
    setDialog((d) => ({ ...d, form: { ...d.form, governorate_id: v, area_id: "" } }));

  /* H-21: initialize the form state EXACTLY ONCE from the SSR data — first
     time the dialog opens, then the state is authoritative (typing, dialog
     open/close, re-render from the parent … must never reset typed values) */
  const initRef = useRef(false);
  useEffect(() => {
    if (dialog.open && !initRef.current) {
      initRef.current = true;
      if (!form.id) {
        setDialog((d) => ({
          ...d,
          form: {
            ...d.form,
            full_name: d.form.full_name || loaderData.profile.full_name,
            phone: d.form.phone || loaderData.profile.phone,
            phone_alternate: d.form.phone_alternate || loaderData.profile.phone_alternate,
          },
        }));
      }
    }
    if (!dialog.open) initRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog.open]);

  /* errors inline-by-field (design skill: error placement next to the field) */
  const reason = fetcher.data && !fetcher.data.ok ? (fetcher.data as { reason?: string }).reason : undefined;
  // dialog persists after a failed save so the errors stay visible (plan H-21)
  useEffect(() => {
    if (fetcher.data?.ok) setDialog((d) => ({ ...d, open: false }));
  }, [fetcher.data]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-extrabold text-text">{t("addresses.list")}</h2>
        <Button type="button" size="sm" onClick={openAdd}>{t("addresses.add")}</Button>
      </div>

      {loaderData.addresses.length === 0 ? (
        <div className="mt-3">
          <EmptyState title={t("addresses.empty")} body={t("addresses.emptyHint")} action={
            <Button type="button" size="sm" onClick={openAdd}>{t("addresses.add")}</Button>
          } />
        </div>
      ) : (
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {(loaderData.addresses as Address[]).map((a) => (
            <li key={a.id} className={`rounded-lg border bg-surface p-4 ${a.is_default ? "border-primary/50" : "border-border"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-extrabold text-text">
                    <span className="truncate">{a.label || a.full_name}</span>
                    {a.is_default ? <Badge tone="success">{t("checkout.defaultAddress")}</Badge> : null}
                    {a.lat != null ? (
                      <Badge tone="info">
                        <PinIcon aria-hidden="true" width={11} height={11} />
                        {t("addresses.pinSet")}
                      </Badge>
                    ) : null}
                  </p>
                  <p className="num mt-0.5 text-[13px] text-text-muted" dir="ltr">{a.phone}</p>
                  {a.phone_alternate ? (
                    <p className="num mt-0.5 text-xs text-text-faint" dir="ltr">{a.phone_alternate}</p>
                  ) : null}
                </div>
                <span aria-hidden="true" className="text-action"><TruckIcon width={18} height={18} /></span>
              </div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-text-muted">
                {a.address1}{a.address2 ? `، ${a.address2}` : ""}
                <span className="block text-xs text-text-faint">{areaName(a.area_id)} · {govName(a.governorate_id)}{a.postal_code ? ` · ${a.postal_code}` : ""}</span>
              </p>
              <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
                <Button type="button" size="sm" variant="outline" onClick={() => openEdit(a)}>{t("addresses.edit")}</Button>
                {!a.is_default ? (
                  <fetcher.Form method="post" preventScrollReset>
                    <input type="hidden" name="intent" value="default" />
                    <input type="hidden" name="id" value={a.id} />
                    <Button type="submit" size="sm" variant="ghost" disabled={busy}>{t("addresses.makeDefault")}</Button>
                  </fetcher.Form>
                ) : null}
                <fetcher.Form method="post" preventScrollReset className="ms-auto">
                  <input type="hidden" name="intent" value="delete" />
                  <input type="hidden" name="id" value={a.id} />
                  <Button type="submit" size="sm" variant="ghost" disabled={busy} className="text-danger">
                    <TrashIcon width={15} height={15} />
                    <span className="sr-only">{t("addresses.delete")}</span>
                  </Button>
                </fetcher.Form>
              </div>
            </li>
          ))}
        </ul>
      )}

      {reason ? (
        <p role="alert" className="mt-2 text-[13px] font-bold text-danger">
          {reason === "phone" || reason === "alternate" ? t("addresses.error_phone")
            : reason === "phones_equal" ? t("checkout.errPhonesEqual")
            : reason === "area" ? t("addresses.error_area")
            : t("addresses.error_failed")}
        </p>
      ) : null}

      {/* add/edit dialog — submitted with fetcher.submit: controlled inputs
          never flip buttons disabed, the pin travels as hidden FormData, and
          a success closes the dialog while an error keeps it open (H-21) */}
      <Dialog open={dialog.open} onClose={() => setDialog((d) => ({ ...d, open: false }))} title={form.id ? t("addresses.edit") : t("addresses.add")}>
        <fetcher.Form
          method="post"
          preventScrollReset
          className="flex flex-col gap-3"
        >
          <input type="hidden" name="intent" value="save" />
          <input type="hidden" name="id" value={form.id} />
          <input type="hidden" name="lat" value={pin?.lat ?? ""} />
          <input type="hidden" name="lng" value={pin?.lng ?? ""} />
          <input type="hidden" name="geo_accuracy" value={pin?.accuracyM ?? ""} />

          {/* email: shown for context, read-only (H-21; never edited here) */}
          <div className="rounded-md bg-surface-tint p-3">
            <p className="text-xs font-bold text-text">{t("checkout.emailLabel")}</p>
            <p className="num text-sm text-text-muted" dir="ltr">{loaderData.profile.email}</p>
            <p className="mt-0.5 text-[11px] text-text-faint">{t("checkout.emailReadOnly")}</p>
          </div>

          <Input id="ad-label" label={`${t("addresses.label")} (${t("checkout.optional")})`} name="label" value={form.label} onChange={(e) => set("label", e.target.value)} />
          <Input id="ad-name" label={t("checkout.fullName")} name="full_name" required autoComplete="name" value={form.full_name} onChange={(e) => set("full_name", e.target.value)} />
          <Input
            id="ad-phone" label={t("checkout.primaryPhone")} name="phone" required type="tel" dir="ltr"
            hint={t("checkout.phoneHint")} value={form.phone} onChange={(e) => set("phone", e.target.value)}
            error={reason === "phone" ? t("addresses.error_phone") : undefined}
          />
          <Input
            id="ad-phone2" label={t("checkout.alternatePhone")} name="phone_alternate" required type="tel" dir="ltr"
            hint={t("addresses.alternateHint")} value={form.phone_alternate} onChange={(e) => set("phone_alternate", e.target.value)}
            error={reason === "alternate" ? t("addresses.error_phone") : reason === "phones_equal" ? t("checkout.errPhonesEqual") : undefined}
          />
          <GovernateAreaSelects
            lang={loaderData.lang}
            governorates={loaderData.governorates as Gov[]}
            governorateId={form.governorate_id}
            areaId={form.area_id}
            onGovernorateChange={onGov}
            onAreaChange={(v) => set("area_id", v)}
            initialAreas={loaderData.areas as Area[]}
            areaError={reason === "area" ? t("addresses.error_area") : undefined}
          />
          <Input id="ad-addr1" label={t("checkout.address1")} name="address1" required value={form.address1} onChange={(e) => set("address1", e.target.value)} />
          <Input id="ad-addr2" label={`${t("checkout.address2")} (${t("checkout.optional")})`} name="address2" value={form.address2} onChange={(e) => set("address2", e.target.value)} />
          <Input id="ad-postal" label={`${t("checkout.postal")} (${t("checkout.optional")})`} name="postal_code" value={form.postal_code} onChange={(e) => set("postal_code", e.target.value)} />

          {/* H-23: optional saved pin — same picker checkout uses */}
          <div>
            <p className="mb-1.5 text-[13px] font-bold text-text">
              {t("addresses.mapTitle")} <span className="font-normal text-text-faint">({t("checkout.optional")})</span>
            </p>
            <LocationPicker value={pin} onChange={setPin} />
            <p className="mt-1 text-[11px] text-text-faint">{t("addresses.mapHint")}</p>
          </div>

          <label className="flex min-h-11 items-center gap-2 text-[13px] text-text">
            <input type="checkbox" name="is_default" checked={form.is_default} onChange={(e) => set("is_default", e.target.checked)} className="size-4 accent-[var(--color-action)]" />
            {t("addresses.makeDefault")}
          </label>
          <div className="mt-1 flex items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDialog((d) => ({ ...d, open: false }))}>{t("addresses.cancel")}</Button>
            <Button type="submit" loading={busy} disabled={busy}>{t("addresses.save")}</Button>
          </div>
        </fetcher.Form>
      </Dialog>
    </div>
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
