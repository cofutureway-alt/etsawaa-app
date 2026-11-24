import { useEffect, useRef, useState } from "react";
import type { Route } from "./+types/vendors";
import { data, Link, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, CardBody, DataTable, Dialog, EmptyState, useToast } from "~/components/ui";
import { CashIcon, ChevronLeftIcon, EyeIcon, EyeOffIcon, PencilIcon, ShieldIcon, StoreIcon } from "~/components/ui/icons";
import { MediaImage } from "~/features/media/components/media-ui";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";
import { PageHeader } from "~/components/layout/PageHeader";
import { egpToPiastres } from "~/lib/money";
import { ListSkeleton, useListLoading } from "~/components/ui/ListLoading";


/**
 * Admin vendors (JOURNEYS §16.4): full list with filters, approval queue
 * (phase 03), KYC verify, + phase-07 row actions — edit (3 tabs), ban/unban,
 * hide listings (confirm dialog), apply penalty. Every action audited by the
 * definer RPCs.
 */

interface VendorQueueRow {
  id: string;
  store_name_ar: string;
  store_name_en: string;
  slug: string;
  status: "draft" | "pending" | "active" | "rejected" | "suspended";
  verification_status: string;
  grace_until: string | null;
  logo_path: string | null;
  hidden_from_listings?: boolean;
  owner_email: string | null;
  owner_id: string | null;
  created_at: string;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) {
    throw Response.redirect(new URL(`/${lang}/auth/login?error=db`, request.url).toString(), 302);
  }
  await requirePanelAccess(client, lang, "admin", request);

  const status = new URL(request.url).searchParams.get("status") ?? "";
  const verify = new URL(request.url).searchParams.get("verify");
  let query = client
    .from("vendors")
    .select("id, owner_id, store_name_ar, store_name_en, slug, status, verification_status, grace_until, logo_path, hidden_from_listings, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (["pending", "active", "rejected", "suspended"].includes(status)) query = query.eq("status", status);
  if (verify) query = query.eq("verification_status", verify);

  const { data: rows, error } = await query;
  const vendorIds = ((rows ?? []) as Array<{ id: string }>).map((row) => row.id);
  const emailByVendor = new Map<string, string>();
  if (vendorIds.length > 0) {
    // owner email: store_members(owner rows) → profiles (same auth user id)
    const { data: members } = await client
      .from("store_members")
      .select("vendor_id, user_id")
      .in("vendor_id", vendorIds)
      .eq("role", "owner");
    const memberRows = (members ?? []) as Array<{ vendor_id: string; user_id: string }>;
    const userIds = [...new Set(memberRows.map((m) => m.user_id))];
    const { data: ownerProfiles } = userIds.length
      ? await client.from("profiles").select("id, email").in("id", userIds)
      : { data: [] as Array<{ id: string; email: string | null }> };
    const emailByUser = new Map(
      ((ownerProfiles ?? []) as Array<{ id: string; email: string | null }>).map((p) => [p.id, p.email]),
    );
    for (const member of memberRows) {
      const email = emailByUser.get(member.user_id);
      if (email) emailByVendor.set(member.vendor_id, email);
    }
  }

  const queue: VendorQueueRow[] = (rows ?? []).map((row: Record<string, unknown>) => {
    return {
      id: row.id as string,
      store_name_ar: row.store_name_ar as string,
      store_name_en: row.store_name_en as string,
      slug: row.slug as string,
      status: row.status as VendorQueueRow["status"],
      verification_status: row.verification_status as string,
      grace_until: (row.grace_until as string | null) ?? null,
      logo_path: (row.logo_path as string | null) ?? null,
      hidden_from_listings: (row.hidden_from_listings as boolean | null) ?? false,
      owner_email: emailByVendor.get(row.id as string) ?? null,
      owner_id: (row.owner_id as string | null) ?? null,
      created_at: row.created_at as string,
    };
  });
  // المالك: المتاجر النشطة تظهر أولًا دائمًا — ترتيب القائمة بأكملها حسب
  // وزن الحالة (active=0 … rejected=4) ثم الأحدث داخل كل مجموعة.
  const statusWeight: Record<VendorQueueRow["status"], number> = {
    active: 0, pending: 1, suspended: 2, draft: 3, rejected: 4,
  };
  queue.sort((a, b) =>
    (statusWeight[a.status] ?? 9) - (statusWeight[b.status] ?? 9) ||
    b.created_at.localeCompare(a.created_at),
  );
  return data({ lang, queue, status, error: error?.message ?? null, supabaseUrl: process.env.SUPABASE_URL ?? "" });
}

type ActionData = { ok: boolean; error?: string };

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data<ActionData>({ ok: false, error: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  const vendorId = String(form.get("vendorId") ?? "");
  const intent = String(form.get("intent") ?? "");
  const reason = String(form.get("reason") ?? "").trim();

  if (intent === "review") {
    const decision = String(form.get("decision") ?? "");
    if (!vendorId || !["approve", "reject"].includes(decision)) {
      return data<ActionData>({ ok: false, error: "input" }, { status: 400 });
    }
    const { error } = await client.rpc("fn_admin_review_vendor", {
      p_vendor_id: vendorId,
      p_decision: decision,
      p_reason: reason,
    });
    if (error) return data<ActionData>({ ok: false, error: error.message }, { status: 400 });
    return { ok: true };
  }
  if (intent === "verify") {
    const decision = String(form.get("decision") ?? "");
    if (!vendorId || !["approve", "reject"].includes(decision)) {
      return data<ActionData>({ ok: false, error: "input" }, { status: 400 });
    }
    const { error } = await client.rpc("fn_admin_verify_vendor", {
      p_vendor_id: vendorId,
      p_decision: decision,
      p_note: reason,
    });
    if (error) return data<ActionData>({ ok: false, error: error.message }, { status: 400 });
    return { ok: true };
  }

  // ── phase 07 (A-04..A-08) ──────────────────────────────────────────────
  if (intent === "ban" || intent === "unban") {
    // ban requires a reason server-side (fn_ban_vendor)
    const { data: res, error } = await client.rpc("fn_ban_vendor", {
      p_vendor_id: vendorId, p_ban: intent === "ban", p_reason: reason,
    });
    if (error) return data<ActionData>({ ok: false, error: error.message }, { status: 400 });
    const r = res as { ok: boolean; reason?: string };
    return r.ok ? { ok: true } : data<ActionData>({ ok: false, error: r.reason ?? "rpc" }, { status: 400 });
  }
  if (intent === "hide" || intent === "unhide") {
    const { data: res, error } = await client.rpc("fn_hide_vendor_listings", {
      p_vendor_id: vendorId, p_hide: intent === "hide", p_reason: reason,
    });
    if (error) return data<ActionData>({ ok: false, error: error.message }, { status: 400 });
    const r = res as { ok: boolean; reason?: string };
    return r.ok ? { ok: true } : data<ActionData>({ ok: false, error: r.reason ?? "rpc" }, { status: 400 });
  }
  if (intent === "penalty") {
    const amount = egpToPiastres(form.get("amount_egp")) ?? 0;
    if (amount <= 0) return data<ActionData>({ ok: false, error: "bad_amount" }, { status: 400 });
    const { data: res, error } = await client.rpc("fn_admin_apply_penalty", {
      p_vendor_id: vendorId, p_amount_piastres: amount, p_reason: reason,
    });
    if (error) return data<ActionData>({ ok: false, error: error.message }, { status: 400 });
    const r = res as { ok: boolean; reason?: string };
    return r.ok ? { ok: true } : data<ActionData>({ ok: false, error: r.reason ?? "rpc" }, { status: 400 });
  }
  return data<ActionData>({ ok: false, error: "intent" }, { status: 400 });
}

const FILTERS = ["pending", "active", "rejected", "suspended", ""] as const;

export default function AdminVendors({ loaderData }: Route.ComponentProps) {
  const listLoading = useListLoading();
  const { t } = useTranslation();
  const lang = loaderData.lang;
  const isAr = lang === "ar";
  const fetcher = useFetcher<ActionData>();
  const toast = useToast();
  const [dialog, setDialog] = useState<null | { row: VendorQueueRow; intent: "review" | "verify" }>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState(false);
  // phase-07 action dialogs
  const [banTarget, setBanTarget] = useState<VendorQueueRow | null>(null);
  const [hideTarget, setHideTarget] = useState<VendorQueueRow | null>(null);
  const [penaltyTarget, setPenaltyTarget] = useState<VendorQueueRow | null>(null);
  const [penaltyAmount, setPenaltyAmount] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const lastToast = useRef<string | null>(null);

  /* one toast + dialog reset per completed action; the lastToast ref guard
     makes the extra dep-triggered runs (t/locale change) no-ops */
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const stamp = fetcher.data.ok ? "ok" : (fetcher.data.error ?? "err");
    if (lastToast.current === stamp) return;
    lastToast.current = stamp;
    if (fetcher.data.ok) {
      toast.showToast("success", t("adminVendors.reviewed"));
      setDialog(null);
      setBanTarget(null);
      setHideTarget(null);
      setPenaltyTarget(null);
      setReason("");
    } else {
      setActionError(fetcher.data.error ?? "rpc");
      toast.showToast("error", t("errors.generic"));
    }
  }, [fetcher.state, fetcher.data, toast, t]);

  function submit(decision: "approve" | "reject") {
    if (!dialog) return;
    const mandatory = dialog.intent === "review" ? decision === "reject" : false;
    if (mandatory && reason.trim() === "") {
      setReasonError(true);
      return;
    }
    setReasonError(false);
    fetcher.submit(
      { intent: dialog.intent, vendorId: dialog.row.id, decision, reason },
      { method: "post" },
    );
  }

  const statusTone = (s: VendorQueueRow["status"]) =>
    s === "active" ? "success" : s === "pending" ? "warning" : s === "draft" ? "neutral" : "danger";

  /** simple fetcher submit for the three confirm-dialogs */
  function submitIntent(intent: string, row: VendorQueueRow, extra: Record<string, string> = {}) {
    setActionError(null);
    fetcher.submit({ intent, vendorId: row.id, reason, ...extra }, { method: "post" });
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("adminVendors.title")}
        count={loaderData.queue.length}
        subtitle={t("adminVendors.subtitle")}
      />

      <div className="flex flex-wrap gap-1.5 rounded-lg border border-border bg-surface p-2 shadow-1" role="tablist" aria-label={t("adminVendors.filter")}>
        {FILTERS.map((filter) => (
          <button
            key={filter || "all"}
            type="button"
            role="tab"
            aria-selected={loaderData.status === filter}
            onClick={() => {
              const url = new URL(window.location.href);
              if (filter) url.searchParams.set("status", filter);
              else url.searchParams.delete("status");
              window.history.replaceState(null, "", url.toString());
              window.location.reload();
            }}
            className={`cursor-pointer rounded-md border px-3.5 py-1.5 text-xs font-bold transition-all duration-150 ${
              loaderData.status === filter
                ? "border-action bg-action text-on-action shadow-1"
                : "border-transparent bg-transparent text-text-muted hover:bg-surface-tint hover:text-text"
            }`}
          >
            {filter ? t(`vendorStates.status.${filter}`) : t("common.all")}
          </button>
        ))}
      </div>

      {listLoading ? <ListSkeleton /> : loaderData.queue.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState title={t("adminVendors.emptyTitle")} body={t("adminVendors.emptyBody")} />
          </CardBody>
        </Card>
      ) : (
        <DataTable
          rows={loaderData.queue}
          rowKey={(row) => row.id}
          searchPlaceholder={t("adminVendors.search")}
          emptyTitle={t("adminVendors.emptySearch")}
          emptyBody={t("adminVendors.emptySearchBody")}
          cardTitle={(row) => (isAr ? row.store_name_ar : row.store_name_en)}
          renderCard={(row) => {
            const name = isAr ? row.store_name_ar : row.store_name_en;
            const profile = row.owner_id ? `/${loaderData.lang}/admin/users/${row.owner_id}?tab=verification` : `/${loaderData.lang}/admin/vendors/${row.id}`;
            const needsReview = row.status === "pending" || row.verification_status === "submitted";
            const managed = row.status === "active" || row.status === "suspended";
            const action = "flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-2 text-sm font-bold text-text transition-colors hover:bg-surface-tint active:bg-surface-tint";
            return (
              <article className="overflow-hidden rounded-xl border border-border bg-surface shadow-1">
                <Link to={profile} className="flex items-center gap-3 p-3.5 active:bg-surface-tint">
                  <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface-tint">
                    {row.logo_path ? (
                      <MediaImage path={row.logo_path} alt="" width={56} height={56} supabaseUrl={loaderData.supabaseUrl} className="size-full object-cover" />
                    ) : (
                      <StoreIcon aria-hidden="true" className="size-6 text-text-faint" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-extrabold text-text">{name}</p>
                    <p className="num truncate text-xs text-text-muted" dir="ltr">{row.owner_email}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <Badge tone={statusTone(row.status)}>{t(`vendorStates.status.${row.status}`)}</Badge>
                      <Badge tone={row.verification_status === "verified" ? "success" : row.verification_status === "grace_expired" ? "danger" : "neutral"}>
                        {t(`vendorStates.verification.${row.verification_status}`)}
                      </Badge>
                      {row.hidden_from_listings ? <Badge tone="warning">{t("adminVendors.productsHidden")}</Badge> : null}
                    </div>
                  </div>
                  <ChevronLeftIcon aria-hidden="true" className="size-5 shrink-0 text-text-faint ltr:rotate-180" />
                </Link>

                {needsReview || managed ? (
                  <div className="flex flex-col gap-2 border-t border-border bg-surface-alt/50 p-3">
                    {needsReview && row.owner_id ? (
                      <Link to={profile} className="flex min-h-11 items-center justify-center rounded-md bg-action px-3 text-sm font-bold text-on-action hover:bg-action-hover">
                        {t("adminVendors.review")}
                      </Link>
                    ) : null}
                    {managed ? (
                      <div className="grid grid-cols-2 gap-2">
                        <Link to={`/${loaderData.lang}/admin/vendors/${row.id}/edit`} className={action}>
                          <PencilIcon aria-hidden="true" className="size-4 text-text-muted" />
                          {t("adminVendors.edit")}
                        </Link>
                        {row.hidden_from_listings ? (
                          <button type="button" onClick={() => submitIntent("unhide", row)} className={action}>
                            <EyeIcon aria-hidden="true" className="size-4 text-text-muted" />
                            {t("adminVendors.unhide")}
                          </button>
                        ) : (
                          <button type="button" onClick={() => { setHideTarget(row); setReason(""); setActionError(null); }} className={action}>
                            <EyeOffIcon aria-hidden="true" className="size-4 text-text-muted" />
                            {t("adminVendors.hide")}
                          </button>
                        )}
                        <button type="button" onClick={() => { setPenaltyTarget(row); setReason(""); setPenaltyAmount(""); setActionError(null); }} className={action}>
                          <CashIcon aria-hidden="true" className="size-4 text-text-muted" />
                          {t("adminVendors.penalty")}
                        </button>
                        {row.status === "active" ? (
                          <button type="button" onClick={() => { setBanTarget(row); setReason(""); setActionError(null); }}
                            className={`${action} border-danger/40 text-danger hover:bg-danger-soft active:bg-danger-soft`}>
                            <ShieldIcon aria-hidden="true" className="size-4" />
                            {t("adminVendors.ban")}
                          </button>
                        ) : (
                          <button type="button" onClick={() => submitIntent("unban", row)} className={action}>
                            <ShieldIcon aria-hidden="true" className="size-4 text-text-muted" />
                            {t("adminVendors.unban")}
                          </button>
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          }}
          columns={[
            {
              key: "store",
              header: t("adminVendors.col.store"),
              text: (row) => `${row.store_name_ar} ${row.store_name_en} ${row.slug}`,
              render: (row) => (
                <div className="flex items-center gap-2.5">
                  <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-tint">
                    {row.logo_path ? (
                      <MediaImage path={row.logo_path} alt="" width={40} height={40} supabaseUrl={loaderData.supabaseUrl} className="size-full object-cover" />
                    ) : null}
                  </div>
                  <div className="min-w-0">
                    {/* H-25: the store NAME opens the full detail page */}
                    <Link to={row.owner_id ? `/${loaderData.lang}/admin/users/${row.owner_id}?tab=verification` : `/${loaderData.lang}/admin/vendors/${row.id}`} className="block truncate text-sm font-bold text-primary hover:underline">
                      {isAr ? row.store_name_ar : row.store_name_en}
                    </Link>
                    <p className="num truncate text-2xs text-text-muted">{row.owner_email}</p>
                  </div>
                </div>
              ),
            },
            {
              key: "status",
              header: t("adminVendors.col.status"),
              text: (row) => row.status,
              render: (row) => (
                <div className="flex flex-wrap items-center gap-1">
                  <Badge tone={statusTone(row.status)}>{t(`vendorStates.status.${row.status}`)}</Badge>
                  <Badge tone={row.verification_status === "verified" ? "success" : row.verification_status === "grace_expired" ? "danger" : "neutral"}>
                    {t(`vendorStates.verification.${row.verification_status}`)}
                  </Badge>
                </div>
              ),
            },
            {
              key: "actions",
              header: t("adminVendors.col.actions"),
              text: () => "",
              render: (row) => (
                <div className="flex flex-wrap items-center gap-1.5">
                  {/* review lives on the seller's profile (verification tab), not in a popup */}
                  {row.owner_id ? (
                    <Link to={`/${loaderData.lang}/admin/users/${row.owner_id}?tab=verification`}
                      className={`rounded-md border px-3 py-1.5 text-sm font-bold ${row.status === "pending" || row.verification_status === "submitted" ? "border-action bg-action text-on-action" : "border-border text-text hover:bg-surface-tint"}`}>
                      {row.status === "pending" || row.verification_status === "submitted" ? t("adminVendors.review") : t("adminVendors.openProfile")}
                    </Link>
                  ) : null}
                  {row.status === "active" || row.status === "suspended" ? (
                    <>
                      <Link to={`/${loaderData.lang}/admin/vendors/${row.id}/edit`} className="rounded-md border border-border px-3 py-1.5 text-sm font-bold text-text hover:bg-surface-tint">
                        {t("adminVendors.edit")}
                      </Link>
                      {row.status === "active" ? (
                        <button type="button" onClick={() => { setBanTarget(row); setReason(""); setActionError(null); }}
                          className="cursor-pointer rounded-md border border-danger/50 px-3 py-1.5 text-sm font-bold text-danger hover:bg-danger-soft">
                          {t("adminVendors.ban")}
                        </button>
                      ) : (
                        <button type="button" onClick={() => submitIntent("unban", row)}
                          className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-sm font-bold text-text hover:bg-surface-tint">
                          {t("adminVendors.unban")}
                        </button>
                      )}
                      {row.hidden_from_listings ? (
                        <button type="button" onClick={() => submitIntent("unhide", row)}
                          className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-sm font-bold text-text hover:bg-surface-tint">
                          {t("adminVendors.unhide")}
                        </button>
                      ) : (
                        <button type="button" onClick={() => { setHideTarget(row); setReason(""); setActionError(null); }}
                          className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-sm font-bold text-text hover:bg-surface-tint">
                          {t("adminVendors.hide")}
                        </button>
                      )}
                      <button type="button" onClick={() => { setPenaltyTarget(row); setReason(""); setPenaltyAmount(""); setActionError(null); }}
                        className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-sm font-bold text-text hover:bg-surface-tint">
                        {t("adminVendors.penalty")}
                      </button>
                    </>
                  ) : null}
                </div>
              ),
            },
          ]}
        />
      )}

      <Dialog open={dialog !== null} onClose={() => setDialog(null)} title={dialog?.intent === "verify" ? t("adminVendors.verifyTitle") : t("adminVendors.reviewTitle")}>
        {dialog ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm font-extrabold text-text">
              {isAr ? dialog.row.store_name_ar : dialog.row.store_name_en}
            </p>
            <p className="text-sm text-text-muted">
              {dialog.intent === "verify" ? t("adminVendors.verifyNote") : t("adminVendors.reviewNote")}
            </p>
            <label className="flex flex-col gap-1.5 text-sm font-bold text-text">
              {t("adminProducts.reason")}
              <textarea
                className={`min-h-20 rounded-md border bg-surface p-2.5 text-sm text-text outline-none focus:shadow-focus ${
                  reasonError ? "border-danger" : "border-border"
                }`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                aria-invalid={reasonError || undefined}
              />
            </label>
            {reasonError ? (
              <p role="alert" className="text-xs font-bold text-danger">{t("adminProducts.reasonRequired")}</p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDialog(null)}>
                {t("common.cancel")}
              </Button>
              <Button variant="outline" onClick={() => submit("reject")}>
                {t("adminProducts.reject")}
              </Button>
              <Button onClick={() => submit("approve")}>{t("adminProducts.approve")}</Button>
            </div>
          </div>
        ) : null}
      </Dialog>

      {/* ── phase-07 dialogs: ban / hide listings / manual penalty ───────── */}
      <Dialog open={banTarget !== null} onClose={() => setBanTarget(null)} title={t("adminVendors.banTitle")}>
        {banTarget ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text">
              {t("adminVendors.banNote", { name: loaderData.lang === "ar" ? banTarget.store_name_ar : banTarget.store_name_en })}
            </p>
            <label className="flex flex-col gap-1.5 text-sm font-bold text-text">
              {t("adminProducts.reason")}
              <textarea className="min-h-16 rounded-md border border-border bg-surface p-2.5 text-sm text-text outline-none focus:shadow-focus"
                value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            {actionError ? <p role="alert" className="text-xs font-bold text-danger">{actionError}</p> : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setBanTarget(null)}>{t("common.cancel")}</Button>
              <Button variant="outline" disabled={reason.trim().length < 3 || fetcher.state !== "idle"}
                onClick={() => submitIntent("ban", banTarget)}>{t("adminVendors.banConfirm")}</Button>
            </div>
          </div>
        ) : null}
      </Dialog>

      <Dialog open={hideTarget !== null} onClose={() => setHideTarget(null)} title={t("adminVendors.hideTitle")}>
        {hideTarget ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text">{t("adminVendors.hideNote")}</p>
            <label className="flex flex-col gap-1.5 text-sm font-bold text-text">
              {t("adminProducts.reason")}
              <textarea className="min-h-16 rounded-md border border-border bg-surface p-2.5 text-sm text-text outline-none focus:shadow-focus"
                value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            {actionError ? <p role="alert" className="text-xs font-bold text-danger">{actionError}</p> : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setHideTarget(null)}>{t("common.cancel")}</Button>
              <Button variant="outline" disabled={reason.trim().length < 3 || fetcher.state !== "idle"}
                onClick={() => submitIntent("hide", hideTarget)}>{t("adminVendors.hideConfirm")}</Button>
            </div>
          </div>
        ) : null}
      </Dialog>

      <Dialog open={penaltyTarget !== null} onClose={() => setPenaltyTarget(null)} title={t("adminVendors.penaltyTitle")}>
        {penaltyTarget ? (
          <div className="flex flex-col gap-3">
            <label htmlFor="penalty-amount" className="flex flex-col gap-1.5 text-sm font-bold text-text">
              {t("adminVendors.penaltyAmount")}
              <input id="penalty-amount" type="number" min={0.01} step="0.01" inputMode="decimal" dir="ltr" value={penaltyAmount}
                onChange={(e) => setPenaltyAmount(e.target.value)}
                className="rounded-md border border-border bg-surface p-2.5 text-sm text-text outline-none focus:shadow-focus" />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-bold text-text">
              {t("adminProducts.reason")}
              <textarea className="min-h-16 rounded-md border border-border bg-surface p-2.5 text-sm text-text outline-none focus:shadow-focus"
                value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            {actionError ? <p role="alert" className="text-xs font-bold text-danger">{actionError}</p> : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPenaltyTarget(null)}>{t("common.cancel")}</Button>
              <Button disabled={!(Number(penaltyAmount) > 0) || reason.trim().length < 3 || fetcher.state !== "idle"}
                onClick={() => submitIntent("penalty", penaltyTarget, { amount_egp: penaltyAmount })}>
                {t("adminVendors.penaltyConfirm")}
              </Button>
            </div>
          </div>
        ) : null}
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
  return <SkeletonTable />;
}
