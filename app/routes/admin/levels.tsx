import { data, useFetcher } from "react-router";
import type { Route } from "./+types/levels";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { Button } from "~/components/ui/Button";
import { Badge } from "~/components/ui/Badge";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";


/**
 * A-19 — Levels & badges (US-09 / AGENT §20): CRUD + rewards (commission
 * discount %, hold days), current vendors per level, manual promote/demote
 * with reason → vendor_level_history + notification. Reward changes apply to
 * FUTURE calculations only (documented).
 */

interface LevelRow {
  id: string; name_ar: string; name_en: string; min_successful_orders: number;
  rewards: { commission_percent?: number; hold_days?: number }; icon: string | null;
  is_active: boolean;
  vendors_count: number;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const [levels, counts] = await Promise.all([
    client.from("vendor_levels").select("*").order("min_successful_orders"),
    client.from("vendors").select("level_id"),
  ]);
  if (levels.error) throw new Error(levels.error.message);
  const byLevel = new Map<string, number>();
  for (const v of (counts.data ?? []) as Array<{ level_id: string | null }>) {
    if (v.level_id) byLevel.set(v.level_id, (byLevel.get(v.level_id) ?? 0) + 1);
  }
  const rows: LevelRow[] = ((levels.data ?? []) as unknown as Array<Record<string, unknown>>).map((l) => ({
    id: l.id as string, name_ar: l.name_ar as string, name_en: l.name_en as string,
    min_successful_orders: l.min_successful_orders as number,
    rewards: (l.rewards ?? {}) as LevelRow["rewards"],
    icon: (l.icon as string | null) ?? null,
    is_active: (l.is_active as boolean) ?? true,
    vendors_count: byLevel.get(l.id as string) ?? 0,
  }));
  const history = await client.from("vendor_level_history")
    .select(`id, reason, created_at, vendors(store_name_ar, store_name_en)`)
    .order("created_at", { ascending: false }).limit(20);
  return {
    lang, levels: JSON.parse(JSON.stringify(rows)),
    history: JSON.parse(JSON.stringify(history.data ?? [])) as unknown as Array<{ id: string; reason: string | null; created_at: string; vendors: { store_name_ar: string; store_name_en: string } | null }>,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "save") {
    const id = String(form.get("id") ?? "");
    const rewards = {
      commission_percent: Number(form.get("commission_percent") ?? 5),
      hold_days: Math.max(0, Math.trunc(Number(form.get("hold_days") ?? 14))),
    };
    const payload = {
      name_ar: String(form.get("name_ar") ?? "").trim(),
      name_en: String(form.get("name_en") ?? "").trim(),
      min_successful_orders: Math.max(0, Math.trunc(Number(form.get("min_orders") ?? 0))),
      rewards,
      is_active: form.get("is_active") === "on",
    };
    if (!payload.name_ar || !payload.name_en) return data({ ok: false, reason: "name_required" }, { status: 400 });
    const { error } = id
      ? await client.from("vendor_levels").update(payload).eq("id", id)
      : await client.from("vendor_levels").insert(payload);
    if (error) return data({ ok: false, reason: error.message }, { status: 400 });
    await client.rpc("fn_audit", {
      p_action: id ? "level.updated" : "level.created", p_entity: "vendor_levels",
      p_entity_id: id || null, p_before: null, p_after: payload,
    });
    return { ok: true as const };
  }

  if (intent === "promote") {
    const res = await client.rpc("fn_promote_vendor_level", {
      p_vendor_id: String(form.get("vendor_id") ?? ""),
      p_to_level: String(form.get("to_level") ?? ""),
      p_reason: String(form.get("reason") ?? ""),
    });
    if (res.error) return data({ ok: false, reason: res.error.message }, { status: 500 });
    const r = res.data as { ok: boolean; reason?: string };
    return r.ok ? { ok: true as const } : data({ ok: false, reason: r.reason }, { status: 400 });
  }
  return data({ ok: false, reason: "bad_intent" }, { status: 400 });
}

export default function AdminLevels({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";

  return (
    <div>
      <h1 className="text-lg font-extrabold text-text">{t("lv.title")}</h1>
      <p className="mt-1 text-[13px] text-text-muted">{t("lv.hint")}</p>

      <ul className="mt-3 flex flex-col gap-2">
        {(loaderData.levels as LevelRow[]).map((l) => (
          <li key={l.id} className="rounded-m border border-border bg-surface p-3">
            <fetcher.Form method="post" className="flex flex-wrap items-end gap-2 text-[13px]">
              <input type="hidden" name="intent" value="save" />
              <input type="hidden" name="id" value={l.id} />
              <label className="flex flex-col gap-1 text-xs font-bold text-text">
                {t("pn.nameAr")}
                <input name="name_ar" defaultValue={l.name_ar} className="w-36 rounded-m border border-border bg-surface px-2 py-1.5" />
              </label>
              <label className="flex flex-col gap-1 text-xs font-bold text-text">
                {t("pn.nameEn")}
                <input name="name_en" defaultValue={l.name_en} dir="ltr" className="w-36 rounded-m border border-border bg-surface px-2 py-1.5" />
              </label>
              <label className="flex flex-col gap-1 text-xs font-bold text-text">
                {t("lv.minOrders")}
                <input name="min_orders" type="number" min={0} defaultValue={l.min_successful_orders} dir="ltr"
                  className="w-20 rounded-m border border-border bg-surface px-2 py-1.5" />
              </label>
              <label className="flex flex-col gap-1 text-xs font-bold text-text">
                {t("lv.commissionPercent")}
                <input name="commission_percent" type="number" min={0} max={100} step="0.1"
                  defaultValue={l.rewards.commission_percent ?? 5} dir="ltr"
                  className="w-20 rounded-m border border-border bg-surface px-2 py-1.5" />
              </label>
              <label className="flex flex-col gap-1 text-xs font-bold text-text">
                {t("lv.holdDays")}
                <input name="hold_days" type="number" min={0} defaultValue={l.rewards.hold_days ?? 14} dir="ltr"
                  className="w-16 rounded-m border border-border bg-surface px-2 py-1.5" />
              </label>
              <label className="flex items-center gap-1.5 text-xs font-bold text-text">
                <input type="checkbox" name="is_active" defaultChecked={l.is_active} className="size-4 accent-[var(--color-action)]" />
                {t("pn.active")}
              </label>
              <Button type="submit" size="sm" disabled={busy}>{t("ve.save")}</Button>
              <Badge tone="neutral">{t("lv.vendors", { count: l.vendors_count })}</Badge>
            </fetcher.Form>
          </li>
        ))}
      </ul>

      {/* manual promote with reason */}
      <section className="mt-5" aria-label={t("lv.manual")}>
        <h2 className="text-sm font-extrabold text-text">{t("lv.manual")}</h2>
        <fetcher.Form method="post" className="mt-2 flex flex-wrap items-end gap-2 text-[13px]">
          <input type="hidden" name="intent" value="promote" />
          <>
            <label className="flex flex-col gap-1 text-xs font-bold text-text">
              {t("lv.vendorId")}
              {/* owner email → vendor resolution happens in the E2E; here raw id for precision */}
              <input name="vendor_id" required dir="ltr" placeholder="uuid" className="w-64 rounded-m border border-border bg-surface px-2 py-1.5" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-bold text-text">
              {t("lv.toLevel")}
              <select name="to_level" className="rounded-m border border-border bg-surface px-2 py-1.5">
                {(loaderData.levels as LevelRow[]).map((l) => (
                  <option key={l.id} value={l.id}>{en ? l.name_en : l.name_ar}</option>
                ))}
              </select>
            </label>
          </>
          <label className="flex flex-col gap-1 text-xs font-bold text-text">
            {t("wd.reason")}
            <input name="reason" required minLength={3} className="w-52 rounded-m border border-border bg-surface px-2 py-1.5" />
          </label>
          <Button type="submit" size="sm" disabled={busy}>{t("lv.apply")}</Button>
          {fetcher.data && !fetcher.data.ok ? (
            <p role="alert" className="text-xs font-bold text-danger">{String(fetcher.data.reason)}</p>
          ) : null}
        </fetcher.Form>
      </section>

      {/* history */}
      <section className="mt-5" aria-label={t("lv.history")}>
        <h2 className="text-sm font-extrabold text-text">{t("lv.history")}</h2>
        <ul className="mt-2 flex flex-col divide-y divide-border rounded-m border border-border bg-surface text-[13px]">
          {(loaderData.history as Array<{ id: string; reason: string | null; created_at: string; vendors: { store_name_ar: string; store_name_en: string } | null }>).map((h) => (            <li key={h.id} className="flex items-center justify-between gap-2 p-2.5">
              <span className="font-bold text-text">{h.vendors ? (en ? h.vendors.store_name_en : h.vendors.store_name_ar) : "—"}</span>
              <span className="flex-1 truncate text-text-muted">{h.reason ?? "—"}</span>
              <span className="text-xs text-text-faint" dir="ltr">{h.created_at.slice(0, 10)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}


/** H-06: friendly route error page (500s log a CORERR id; 403/404 keep their message) */
export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonTable />;
}
