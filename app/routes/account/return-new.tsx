import { Link, data, redirect, useFetcher } from "react-router";
import type { Route } from "./+types/return-new";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { formatPiastres } from "~/lib/money";
import { getOwnOrder, getOrderParts, requestedQtyByItem } from "~/features/orders/api";
import { EvidenceUploader } from "~/features/account/EvidenceUploader";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonForm } from "~/components/ui/Skeleton";


/**
 * Refund request wizard (US-11): kind (return 14d / warranty 30d from
 * delivered_at) → items + quantities → reasons + description + evidence →
 * submit → "under admin review". Server re-validates everything in
 * fn_request_refund (windows, duplicates, per-item quantities).
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "account", request);
  const order = await getOwnOrder(client, params.number ?? "");
  if (!order) throw new Response("Not found", { status: 404 });
  if (!order.delivered_at) {
    throw redirect(`/${lang}/account/orders/${encodeURIComponent(params.number ?? "")}`);
  }
  const parts = await getOrderParts(client, order.id);
  const requested = await requestedQtyByItem(client, parts.items.map((i) => i.id));
  const url = new URL(request.url);
  return {
    lang,
    orderNumber: order.number,
    deliveredAt: order.delivered_at,
    items: JSON.parse(JSON.stringify(parts.items)),
    groups: JSON.parse(JSON.stringify(parts.groups)),
    requested: Object.fromEntries(requested),
    preselect: url.searchParams.get("items") ?? "",
    preKind: (url.searchParams.get("kind") === "warranty" ? "warranty" : "return") as "return" | "warranty",
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "account", request);
  const order = await getOwnOrder(client, params.number ?? "");
  if (!order) return data({ ok: false, reason: "not_found" }, { status: 404 });
  const form = await request.formData();

  const kind = String(form.get("kind") ?? "return") === "warranty" ? "warranty" : "return";
  const itemIds = form.getAll("item_ids").map(String);
  const evidenceRaw = String(form.get("evidence") ?? "[]");
  let evidence: string[] = [];
  try {
    const parsed = JSON.parse(evidenceRaw) as unknown;
    if (Array.isArray(parsed)) evidence = parsed.filter((x): x is string => typeof x === "string");
  } catch { /* stays empty */ }

  const lines = itemIds.map((id) => ({
    order_item_id: id,
    qty: Math.max(1, Number(form.get(`qty_${id}`) ?? 1)),
    reason: String(form.get(`reason_${id}`) ?? "defect"),
  }));
  const { data: res, error } = await client.rpc("fn_request_refund", {
    p_order_id: order.id,
    p_kind: kind,
    p_items: lines,
    p_description: String(form.get("description") ?? ""),
    p_evidence: evidence,
  });
  if (error) return data({ ok: false, reason: "server_error" }, { status: 500 });
  const r = res as { ok: boolean; reason?: string };
  if (!r.ok) return data({ ok: false, reason: r.reason }, { status: 400 });
  throw redirect(`/${lang}/account/returns?submitted=1`);
}

const REASONS = ["defect", "wrong_item", "damaged", "not_received", "change_of_mind"] as const;

export default function ReturnWizard({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const money = (p: number) => formatPiastres(p, en ? "en" : "ar");
  const fetcher = useFetcher<typeof action>();
  const [kind, setKind] = useState<"return" | "warranty">(loaderData.preKind);
  const [selected, setSelected] = useState<string[]>(
    loaderData.preselect ? loaderData.preselect.split(",").filter((id) => loaderData.items.some((i: { id: string }) => i.id === id)) : [],
  );
  const [evidence, setEvidence] = useState<string[]>([]);

  const deliveredAt = new Date(loaderData.deliveredAt);
  const returnDaysLeft = Math.max(0, 14 - Math.floor((Date.now() - deliveredAt.getTime()) / 86400000));
  const warrantyDaysLeft = Math.max(0, 30 - Math.floor((Date.now() - deliveredAt.getTime()) / 86400000));

  const remainingFor = (id: string, qty: number) => qty - (loaderData.requested[id] ?? 0);
  const anyRemaining = loaderData.items.some((i: { id: string; qty: number }) => remainingFor(i.id, i.qty) > 0);

  return (
    <div className="max-w-2xl">
      <p className="text-sm">
        <Link to={`/${loaderData.lang}/account/orders/${encodeURIComponent(loaderData.orderNumber)}`} className="font-bold text-action hover:underline">
          {loaderData.orderNumber}
        </Link>
      </p>
      <h1 className="mt-1 text-lg font-extrabold text-text">{t("returns.wizardTitle")}</h1>

      {fetcher.data && !fetcher.data.ok ? (
        <p role="alert" className="mt-3 rounded-md border border-danger bg-surface p-3 text-sm font-bold text-danger">
          {fetcher.data.reason === "window_expired" ? t("returns.windowExpired")
            : fetcher.data.reason === "qty_exceeded" ? t("returns.qtyExceeded")
            : fetcher.data.reason === "no_items" ? t("returns.noItems")
            : t("returns.failed")}
        </p>
      ) : null}

      {!anyRemaining ? (
        <p className="mt-4 rounded-md border border-border bg-surface-tint p-3 text-sm text-text-muted">{t("returns.fullyRequestedAll")}</p>
      ) : (
        <fetcher.Form method="post" preventScrollReset className="mt-4 flex flex-col gap-5">
          {/* step 1 — kind */}
          <fieldset>
            <legend className="text-sm font-bold text-text">{t("returns.kindTitle")}</legend>
            <div className="mt-2 flex flex-col gap-2">
              <label className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${kind === "return" ? "border-action bg-surface-tint" : "border-border"}`}>
                <input type="radio" name="kind" value="return" checked={kind === "return"} onChange={() => setKind("return")} className="mt-1 size-4 accent-[var(--color-action)]" />
                <span className="text-sm">
                  <span className="block font-bold text-text">{t("returns.kindReturn")}</span>
                  <span className="block text-text-muted">{t("returns.returnWindow", { days: returnDaysLeft })}</span>
                </span>
              </label>
              <label className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${kind === "warranty" ? "border-action bg-surface-tint" : "border-border"}`}>
                <input type="radio" name="kind" value="warranty" checked={kind === "warranty"} onChange={() => setKind("warranty")} className="mt-1 size-4 accent-[var(--color-action)]" />
                <span className="text-sm">
                  <span className="block font-bold text-text">{t("returns.kindWarranty")}</span>
                  <span className="block text-text-muted">{t("returns.warrantyWindow", { days: warrantyDaysLeft })}</span>
                </span>
              </label>
            </div>
          </fieldset>

          {/* step 2 — items + qty + reason */}
          <fieldset>
            <legend className="text-sm font-bold text-text">{t("returns.itemsTitle")}</legend>
            <div className="mt-2 flex flex-col gap-2">
              {loaderData.items.map((it: {
                id: string; product_name_ar: string; product_name_en: string; option_key: string;
                qty: number; line_total_piastres: number; group_id: string;
              }) => {
                const remaining = remainingFor(it.id, it.qty);
                const group = loaderData.groups.find((g: { id: string }) => g.id === it.group_id);
                const checked = selected.includes(it.id);
                return (
                  <div key={it.id} className={`rounded-md border p-3 ${checked ? "border-action bg-surface-tint" : "border-border"}`}>
                    <label className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1 size-4 accent-[var(--color-action)]"
                        checked={checked}
                        disabled={remaining <= 0}
                        onChange={(e) => setSelected((s) => (e.target.checked ? [...s, it.id] : s.filter((x) => x !== it.id)))}
                      />
                      <span className="flex-1 text-sm">
                        <span className="block font-bold text-text">
                          {en ? it.product_name_en : it.product_name_ar}{it.option_key ? ` (${it.option_key})` : ""}
                        </span>
                        <span className="block text-text-muted">
                          {en ? group?.vendor.store_name_en : group?.vendor.store_name_ar} · {money(it.line_total_piastres)}
                        </span>
                        {remaining <= 0 ? <span className="block text-xs text-text-faint">{t("returns.fullyRequested")}</span> : null}
                      </span>
                    </label>
                    {checked && remaining > 0 ? (
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <label className="text-xs font-bold text-text">
                          {t("returns.qtyLabel")} ({remaining})
                          <input
                            type="number" name={`qty_${it.id}`} min={1} max={remaining} defaultValue={remaining}
                            className="ms-2 w-20 rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text"
                          />
                        </label>
                        <label className="text-xs font-bold text-text">
                          {t("returns.reasonLabel")}
                          <select name={`reason_${it.id}`} className="ms-2 rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text">
                            {REASONS.map((r) => (
                              <option key={r} value={r}>{t(`returns.reason_${r}`)}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                    ) : null}
                    {checked ? <input type="hidden" name="item_ids" value={it.id} /> : null}
                  </div>
                );
              })}
            </div>
          </fieldset>

          {/* step 3 — description + evidence */}
          <fieldset>
            <legend className="text-sm font-bold text-text">{t("returns.detailsTitle")}</legend>
            <textarea
              name="description" rows={3} maxLength={2000} required
              placeholder={t("returns.descriptionPlaceholder")}
              className="mt-2 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-primary focus:shadow-focus"
            />
            <div className="mt-2">
              <EvidenceUploader onChange={setEvidence} />
              <input type="hidden" name="evidence" value={JSON.stringify(evidence)} />
            </div>
          </fieldset>

          <p className="text-sm text-text-muted">{t("returns.reviewNotice")}</p>
          <button
            type="submit"
            disabled={selected.length === 0 || fetcher.state !== "idle"}
            className="w-fit cursor-pointer rounded-md bg-action px-6 py-3 text-sm font-bold text-on-action transition-colors duration-150 hover:bg-action-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t("returns.submitButton")}
          </button>
        </fetcher.Form>
      )}
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
