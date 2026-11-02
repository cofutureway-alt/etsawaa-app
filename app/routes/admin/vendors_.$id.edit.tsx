import { data } from "react-router";
import type { Route } from "./+types/vendors_.$id.edit";
import { useState } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { formatPiastres } from "~/lib/money";
import { Button } from "~/components/ui/Button";
import { Card, CardBody, CardHeader } from "~/components/ui";
import { Badge } from "~/components/ui/Badge";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonForm } from "~/components/ui/Skeleton";


/**
 * A-05/A-06/A-07 — Vendor edit · three independent tabs:
 *   General (selling permissions, featured, store data read-out),
 *   Commissions (inherit | fixed | category, with a next-order preview),
 *   Social + verification + penalties + wallet + ads history.
 * Each tab saves independently (form-per-tab → its own fetcher call).
 */

type TabKey = "general" | "commissions" | "details";

interface EditorVendor {
  id: string; slug: string;
  store_name_ar: string; store_name_en: string;
  status: string; verification_status: string;
  logo_path: string | null;
  socials: Record<string, string>;
  commission_mode: "inherit" | "fixed" | "category";
  commission_fixed_percent: number | null;
  allow_direct_publish: boolean;
  can_change_order_status: boolean;
  featured_permanent: boolean; featured_until: string | null;
  level_name: string | null;
  area_name: string | null;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const id = String(params.id ?? "");
  const { data: v, error } = await client.from("vendors").select(
    `id, slug, store_name_ar, store_name_en, status, verification_status, logo_path, socials,
     commission_mode, commission_fixed_percent, allow_direct_publish, can_change_order_status,
     featured_permanent, featured_until, level_id, area_id,
     vendor_levels(name_ar, name_en), areas(name_ar, name_en)`
  ).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!v) throw new Response("Not found", { status: 404 });

  const overrides = await client.from("vendor_commission_overrides")
    .select("category_id, percent").eq("vendor_id", id);
  const pen = await client.from("vendor_penalties")
    .select("id, amount_piastres, reason, status, created_at").eq("vendor_id", id)
    .order("created_at", { ascending: false }).limit(20);
  const wallet = await client.from("wallets").select("available_piastres, pending_piastres")
    .eq("vendor_id", id).maybeSingle();
  const ads = await client.from("ad_campaigns")
    .select("id, source, status, started_at, ends_at, ad_packages(name_ar, name_en)")
    .eq("vendor_id", id).order("created_at", { ascending: false }).limit(10);
  const docs = await client.from("vendor_documents")
    .select("id, doc_type, file_path, created_at").eq("vendor_id", id);

  const row = v as unknown as Record<string, unknown>;
  const lvl = row.vendor_levels as { name_ar: string; name_en: string } | null;
  const area = row.areas as { name_ar: string; name_en: string } | null;
  const vendor: EditorVendor = {
    id: row.id as string, slug: row.slug as string,
    store_name_ar: row.store_name_ar as string, store_name_en: row.store_name_en as string,
    status: row.status as string, verification_status: row.verification_status as string,
    logo_path: (row.logo_path as string | null) ?? null,
    socials: (row.socials ?? {}) as Record<string, string>,
    commission_mode: (row.commission_mode ?? "inherit") as EditorVendor["commission_mode"],
    commission_fixed_percent: (row.commission_fixed_percent as number | null) ?? null,
    allow_direct_publish: (row.allow_direct_publish as boolean) ?? false,
    can_change_order_status: (row.can_change_order_status as boolean) ?? true,
    featured_permanent: (row.featured_permanent as boolean) ?? false,
    featured_until: (row.featured_until as string | null) ?? null,
    level_name: lvl ? (lang === "en" ? lvl.name_en : lvl.name_ar) : null,
    area_name: area ? (lang === "en" ? area.name_en : area.name_ar) : null,
  };
  return {
    lang, vendor,
    overrides: JSON.parse(JSON.stringify(overrides.data ?? [])) as Array<{ category_id: string; percent: number }>,
    penalties: JSON.parse(JSON.stringify(pen.data ?? [])) as Array<{ id: string; amount_piastres: number; reason: string; status: string; created_at: string }>,
    wallet: JSON.parse(JSON.stringify(wallet.data ?? null)) as { available_piastres: number; pending_piastres: number } | null,
    ads: JSON.parse(JSON.stringify(ads.data ?? [])) as Array<{ id: string; source: string; status: string; started_at: string; ends_at: string; ad_packages: { name_ar: string; name_en: string } | null }>,
    docs: JSON.parse(JSON.stringify(docs.data ?? [])) as Array<{ id: string; doc_type: string; file_path: string; created_at: string }>,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  const vendorId = String(params.id ?? "");
  const intent = String(form.get("intent") ?? "");

  if (intent === "general") {
    // direct publish permission + order-status permission + featured (timed/permanent)
    const allowDirect = form.get("allow_direct_publish") === "on";
    const canChange = form.get("can_change_order_status") === "on";
    const featuredPermanent = form.get("featured_permanent") === "on";
    const featuredDays = Math.max(0, Math.trunc(Number(form.get("featured_days") ?? 0)) || 0);
    const featuredUntil = featuredPermanent
      ? null
      : featuredDays > 0 ? new Date(Date.now() + featuredDays * 86400000).toISOString() : null;
    const { error } = await client.from("vendors").update({
      allow_direct_publish: allowDirect,
      can_change_order_status: canChange,
      featured_permanent: featuredPermanent,
      featured_until: featuredUntil,
      updated_at: new Date().toISOString(),
    }).eq("id", vendorId);
    if (error) return data({ ok: false, reason: error.message }, { status: 400 });
    await client.rpc("fn_audit", {
      p_action: "vendor.general.updated", p_entity: "vendors", p_entity_id: vendorId,
      p_before: null,
      p_after: { allow_direct_publish: allowDirect, can_change_order_status: canChange, featured_until: featuredUntil },
    });
    return { ok: true as const };
  }

  if (intent === "commission") {
    const mode = String(form.get("mode") ?? "inherit");
    const fixed = form.get("fixed_percent");
    const res = await client.rpc("fn_admin_set_commission", {
      p_vendor_id: vendorId,
      p_mode: mode,
      p_fixed_percent: fixed === "" || fixed === null ? null : Number(fixed),
      p_overrides: null,
    });
    const r = res.data as { ok: boolean; reason?: string } | null;
    if (!r?.ok) return data({ ok: false, reason: r?.reason ?? "rpc" }, { status: 400 });
    return { ok: true as const };
  }

  if (intent === "social") {
    const socials = {
      facebook: String(form.get("facebook") ?? ""),
      instagram: String(form.get("instagram") ?? ""),
      x: String(form.get("x") ?? ""),
      tiktok: String(form.get("tiktok") ?? ""),
      whatsapp: String(form.get("whatsapp") ?? ""),
    };
    const { error } = await client.from("vendors").update({ socials, updated_at: new Date().toISOString() })
      .eq("id", vendorId);
    if (error) return data({ ok: false, reason: error.message }, { status: 400 });
    await client.rpc("fn_audit", {
      p_action: "vendor.social.updated", p_entity: "vendors", p_entity_id: vendorId,
      p_before: null, p_after: socials,
    });
    return { ok: true as const };
  }

  if (intent === "adjust") {
    // A-29 — manual wallet adjustment (reason mandatory, audited, signed)
    const amount = Math.trunc(Number(form.get("amount_piastres") ?? 0)) || 0;
    const reason = String(form.get("reason") ?? "").trim();
    const res = await client.rpc("fn_admin_adjust_wallet", {
      p_vendor_id: vendorId, p_amount_piastres: amount, p_reason: reason,
      p_reference: String(form.get("reference") ?? "") || null,
    });
    if (res.error) return data({ ok: false, reason: res.error.message }, { status: 500 });
    const r = res.data as { ok: boolean; reason?: string };
    return r.ok ? { ok: true as const } : data({ ok: false, reason: r.reason }, { status: 400 });
  }

  return data({ ok: false, reason: "bad_intent" }, { status: 400 });
}

function Toggle({ id, label, defaultChecked, name }: { id: string; label: string; defaultChecked: boolean; name: string }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-2.5 text-[13px] font-bold text-text">
      <input id={id} type="checkbox" name={name} defaultChecked={defaultChecked}
        className="size-4 accent-[var(--color-action)]" />
      {label}
    </label>
  );
}

export default function AdminVendorEdit({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const lang = loaderData.lang;
  const en = i18n.language?.startsWith("en");
  const v = loaderData.vendor;
  const [tab, setTab] = useState<TabKey>("general");
  const [mode, setMode] = useState<TabKey extends never ? never : EditorVendor["commission_mode"]>(v.commission_mode);
  const genFetcher = useFetcher<typeof action>();
  const comFetcher = useFetcher<typeof action>();
  const socFetcher = useFetcher<typeof action>();
  const adjFetcher = useFetcher<typeof action>();

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: "general", label: t("ve.tabGeneral") },
    { key: "commissions", label: t("ve.tabCommissions") },
    { key: "details", label: t("ve.tabDetails") },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <a href={`/${lang}/admin/vendors?status=all`} className="text-[13px] font-bold text-primary hover:underline">
          {t("ve.back")}
        </a>
      </div>
      <h1 className="mt-1 text-lg font-extrabold text-text">{en ? v.store_name_en : v.store_name_ar}</h1>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-text-muted">
        <Badge tone={v.status === "active" ? "success" : v.status === "suspended" ? "danger" : "neutral"}>
          {t(`vendorStates.status.${v.status}`)}
        </Badge>
        <Badge tone="neutral">{t(`vendorStates.verification.${v.verification_status}`)}</Badge>
        {v.level_name ? <Badge tone="neutral">{v.level_name}</Badge> : null}
        <span dir="ltr" className="num">{v.slug}</span>
      </div>

      {/* tabs (skill: active state clearly indicated) */}
      <div role="tablist" aria-label={t("ve.tabs")} className="mt-4 flex gap-1 border-b border-border">
        {tabs.map((x) => (
          <button key={x.key} type="button" role="tab" aria-selected={tab === x.key}
            onClick={() => setTab(x.key)}
            className={`cursor-pointer rounded-t-m px-4 py-2 text-[13px] font-bold ${
              tab === x.key ? "border-x border-t border-border bg-surface text-primary" : "text-text-muted hover:bg-surface-tint"
            }`}>
            {x.label}
          </button>
        ))}
      </div>

      {/* ── TAB 1: GENERAL ─────────────────────────────────────────────── */}
      {tab === "general" ? (
        <Card className="mt-3">
          <CardHeader title={t("ve.tabGeneral")} />
          <CardBody>
            <genFetcher.Form method="post" className="flex flex-col gap-3">
              <input type="hidden" name="intent" value="general" />
              <Toggle id="f-direct" name="allow_direct_publish" label={t("ve.directPublish")} defaultChecked={v.allow_direct_publish} />
              <Toggle id="f-status" name="can_change_order_status" label={t("ve.changeStatus")} defaultChecked={v.can_change_order_status} />
              <Toggle id="f-feat-perm" name="featured_permanent" label={t("ve.featuredPermanent")} defaultChecked={v.featured_permanent} />
              <label htmlFor="f-feat-days" className="flex flex-col gap-1.5 text-[13px] font-bold text-text">
                {t("ve.featuredDays")}
                <input id="f-feat-days" name="featured_days" type="number" min={0} dir="ltr"
                  className="w-28 rounded-m border border-border bg-surface p-2.5 text-sm text-text" />
              </label>
              <div className="flex items-center gap-3">
                <Button type="submit" disabled={genFetcher.state !== "idle"}>{t("ve.save")}</Button>
                {genFetcher.state === "idle" && genFetcher.data?.ok ? (
                  <span className="text-[13px] font-bold text-success">{t("ve.saved")}</span>
                ) : null}
              </div>
            </genFetcher.Form>

            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px] md:grid-cols-3">
              <dt className="text-text-muted">{t("ve.area")}</dt><dd className="font-bold text-text">{v.area_name ?? "—"}</dd>
              <dt className="text-text-muted">{t("ve.featuredUntil")}</dt>
              <dd className="font-bold text-text" dir="ltr">
                {v.featured_permanent ? t("ve.featuredPermanent") : v.featured_until ? v.featured_until.slice(0, 10) : "—"}
              </dd>
            </dl>
          </CardBody>
        </Card>
      ) : null}

      {/* ── TAB 2: COMMISSIONS ─────────────────────────────────────────── */}
      {tab === "commissions" ? (
        <Card className="mt-3">
          <CardHeader title={t("ve.tabCommissions")} />
          <CardBody>
            <comFetcher.Form method="post" className="flex flex-col gap-3">
              <input type="hidden" name="intent" value="commission" />
              <input type="hidden" name="mode" value={mode} />
              <fieldset className="flex flex-col gap-2">
                <legend className="text-[13px] font-bold text-text">{t("ve.commissionMode")}</legend>
                {([
                  { key: "inherit", label: t("ve.inherit") },
                  { key: "fixed", label: t("ve.fixed") },
                  { key: "category", label: t("ve.category") },
                ] as const).map((opt) => (
                  <label key={opt.key} className="flex cursor-pointer items-center gap-2.5 text-[13px] text-text">
                    <input type="radio" name="mode-radio" checked={mode === opt.key}
                      onChange={() => setMode(opt.key)} className="size-4 accent-[var(--color-action)]" />
                    {opt.label}
                  </label>
                ))}
              </fieldset>
              {mode === "fixed" ? (
                <label htmlFor="f-fixed" className="flex flex-col gap-1.5 text-[13px] font-bold text-text">
                  {t("ve.fixedPercent")}
                  <input id="f-fixed" name="fixed_percent" type="number" min={0} max={100} step="0.01" dir="ltr"
                    defaultValue={v.commission_fixed_percent ?? ""}
                    className="w-28 rounded-m border border-border bg-surface p-2.5 text-sm text-text" />
                </label>
              ) : null}
              {mode === "category" ? (
                <p className="text-[13px] text-text-muted">{t("ve.categoryHint")}</p>
              ) : null}
              {/* preview: next-order commission at the current selection */}
              <p className="text-[13px] text-text-muted">
                {t("ve.preview")}:{" "}
                <strong className="text-text" dir="ltr">
                  {mode === "fixed"
                    ? `${v.commission_fixed_percent ?? 0}%`
                    : mode === "category"
                      ? t("ve.previewCategory")
                      : t("ve.previewLevel", { level: v.level_name ?? "—" })}
                </strong>
              </p>
              <div className="flex items-center gap-3">
                <Button type="submit" disabled={comFetcher.state !== "idle"}>{t("ve.save")}</Button>
                {comFetcher.state === "idle" && comFetcher.data?.ok ? (
                  <span className="text-[13px] font-bold text-success">{t("ve.saved")}</span>
                ) : null}
                {comFetcher.state === "idle" && comFetcher.data && !comFetcher.data.ok ? (
                  <span className="text-[13px] font-bold text-danger">{comFetcher.data.reason}</span>
                ) : null}
              </div>
            </comFetcher.Form>
            {loaderData.overrides.length > 0 ? (
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {loaderData.overrides.map((o) => (
                  <li key={o.category_id} className="rounded-m border border-border px-2 py-1 text-xs text-text" dir="ltr">
                    {o.category_id.slice(0, 8)} · {o.percent}%
                  </li>
                ))}
              </ul>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {/* ── TAB 3: DETAILS (social + wallet + penalties + ads + docs) ──── */}
      {tab === "details" ? (
        <div className="mt-3 flex flex-col gap-3">
          <Card>
            <CardHeader title={t("ve.social")} />
            <CardBody>
              <socFetcher.Form method="post" className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="intent" value="social" />
                {[["facebook", "Facebook"], ["instagram", "Instagram"], ["x", "X"], ["tiktok", "TikTok"], ["whatsapp", "WhatsApp"]].map(([field, label]) => (
                  <label key={field as string} htmlFor={`soc-${field}`} className="flex flex-col gap-1.5 text-[13px] font-bold text-text">
                    {label}
                    <input id={`soc-${field}`} name={field} type="url" dir="ltr" defaultValue={v.socials[field as string] ?? ""}
                      className="rounded-m border border-border bg-surface p-2.5 text-sm text-text" />
                  </label>
                ))}
                <div className="flex items-center gap-3 sm:col-span-2">
                  <Button type="submit" disabled={socFetcher.state !== "idle"}>{t("ve.save")}</Button>
                  {socFetcher.state === "idle" && socFetcher.data?.ok ? (
                    <span className="text-[13px] font-bold text-success">{t("ve.saved")}</span>
                  ) : null}
                </div>
              </socFetcher.Form>
            </CardBody>
          </Card>

          {/* A-29 — manual wallet adjustment (credit + / debit −; reason mandatory) */}
          <Card>
            <CardHeader title={t("ve.adjust")} />
            <CardBody>
              <adjFetcher.Form method="post" className="flex flex-wrap items-end gap-2 text-[13px]">
                <input type="hidden" name="intent" value="adjust" />
                <label className="flex flex-col gap-1 text-xs font-bold text-text">
                  {t("ve.adjustAmount")}
                  <input name="amount_piastres" type="number" required dir="ltr" placeholder="+/−"
                    className="w-28 rounded-m border border-border bg-surface px-2 py-1.5" />
                </label>
                <label className="flex flex-1 flex-col gap-1 text-xs font-bold text-text">
                  {t("wd.reason")}
                  <input name="reason" required minLength={3} className="w-52 rounded-m border border-border bg-surface px-2 py-1.5" />
                </label>
                <label className="flex flex-col gap-1 text-xs font-bold text-text">
                  {t("ve.adjustRef")}
                  <input name="reference" dir="ltr" placeholder="—" className="w-36 rounded-m border border-border bg-surface px-2 py-1.5" />
                </label>
                <Button type="submit" size="sm" disabled={adjFetcher.state !== "idle"}>{t("lv.apply")}</Button>
                {adjFetcher.state === "idle" && adjFetcher.data?.ok ? (
                  <span className="text-[13px] font-bold text-success-strong">{t("ve.saved")}</span>
                ) : null}
                {adjFetcher.data && !adjFetcher.data.ok ? (
                  <p role="alert" className="text-xs font-bold text-danger">{String(adjFetcher.data.reason)}</p>
                ) : null}
              </adjFetcher.Form>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t("ve.wallet")} />
            <CardBody className="grid grid-cols-2 gap-2">
              <div className="rounded-m border border-border bg-surface px-3 py-2.5">
                <p className="text-[11px] font-bold text-text-muted">{t("ve.available")}</p>
                <p className="text-base font-extrabold tabular-nums text-text" dir="ltr">
                  {formatPiastres(loaderData.wallet?.available_piastres ?? 0, en ? "en" : "ar")}
                </p>
              </div>
              <div className="rounded-m border border-border bg-surface px-3 py-2.5">
                <p className="text-[11px] font-bold text-text-muted">{t("ve.pending")}</p>
                <p className="text-base font-extrabold tabular-nums text-text" dir="ltr">
                  {formatPiastres(loaderData.wallet?.pending_piastres ?? 0, en ? "en" : "ar")}
                </p>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t("ve.penalties")} />
            <CardBody>
              {loaderData.penalties.length === 0 ? (
                <p className="text-[13px] text-text-muted">{t("ve.none")}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border text-[13px]">
                  {loaderData.penalties.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 py-1.5">
                      <span className="truncate text-text">{p.reason}</span>
                      <span className="flex items-center gap-2">
                        <Badge tone={p.status === "waived" ? "neutral" : "danger"}>{t(`pen.status_${p.status}`)}</Badge>
                        <span className="tabular-nums text-text-muted" dir="ltr">{formatPiastres(p.amount_piastres, en ? "en" : "ar")}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t("ve.ads")} />
            <CardBody>
              {loaderData.ads.length === 0 ? (
                <p className="text-[13px] text-text-muted">{t("ve.none")}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border text-[13px]">
                  {loaderData.ads.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2 py-1.5">
                      <span className="text-text">{a.ad_packages ? (en ? a.ad_packages.name_en : a.ad_packages.name_ar) : "—"}</span>
                      <span className="flex items-center gap-2">
                        <Badge tone={a.source === "admin_grant" ? "neutral" : "success"}>{t(`ads.source_${a.source}`)}</Badge>
                        <span className="text-xs text-text-muted" dir="ltr">{a.ends_at.slice(0, 10)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t("ve.documents")} />
            <CardBody>
              {loaderData.docs.length === 0 ? (
                <p className="text-[13px] text-text-muted">{t("ve.none")}</p>
              ) : (
                <ul className="flex flex-col gap-1 text-[13px] text-text">
                  {loaderData.docs.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-2">
                      <span>{t(`onboarding.doc_${d.doc_type}`)}</span>
                      <span className="text-xs text-text-muted" dir="ltr">{d.created_at.slice(0, 10)}</span>
                      {/* never expose raw storage URLs — admin sees the reference only;
                          document bodies stream via the signed-URL flow (AGENT §12) */}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      ) : null}
    </div>
  );
}


/** H-06: friendly route error page (500s log a CORERR id; 403/404 keep their message) */
export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonForm />;
}
