import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Route } from "./+types/users";
import { Link, data, useFetcher, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { safeLikeTerm } from "~/lib/postgrest";
import { Button, Dialog, EmptyState, Input } from "~/components/ui";
import {
  ChevronRightIcon, EyeIcon, EyeOffIcon, PlusIcon, SearchIcon, SettingsIcon, ShieldIcon,
  StoreIcon, TrashIcon, UserIcon, UsersIcon, XIcon,
} from "~/components/ui/icons";
import { Pagination } from "~/components/ui/Pagination";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";
import { PageHeader } from "~/components/layout/PageHeader";
import { useActionToast } from "~/components/layout/ActionFeedback";
import { UserAvatar } from "~/components/admin/UserAvatar";
import { handleUserAction } from "~/features/admin/users.server";
import { createUserFromAdmin } from "~/features/admin/create-user.server";
import { CreateUserDialog } from "~/components/admin/CreateUserDialog";
import { DEFAULT_STAFF_PERMISSIONS, ROLES, baseRole, can, creatableRoles, type CustomRole } from "~/lib/permissions";
import { ListSkeleton, useListLoading } from "~/components/ui/ListLoading";

/**
 * Users & roles: every account (customers, sellers, staff, admins).
 * Role cards double as filters; the table shows who, role (changeable in
 * place), store, status and join date. Rows can be multi-selected for bulk
 * ban / unban / role change / delete. Each row has a ⋯ menu for the
 * per-person actions; the full profile lives on /admin/users/:id.
 */

const PAGE_SIZE = 25;
const FILTERS = ["", "customer", "vendor", "staff", "admin", "blocked"] as const;

export interface UserListRow {
  id: string; full_name: string; email: string | null; phone: string | null; avatar_url: string | null;
  role: string; status: string; created_at: string;
  /** custom role (staff sub-role) when role = staff */
  staff_role: string | null;
  store: { id: string; name_ar: string; name_en: string; hidden: boolean; status: string } | null;
  /** never entered the email code */
  unconfirmed?: boolean;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "admin", request);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
  const filter = (FILTERS as readonly string[]).includes(url.searchParams.get("f") ?? "") ? url.searchParams.get("f") ?? "" : "";
  const page = Math.max(1, Math.trunc(Number(url.searchParams.get("page"))) || 1);
  const from = (page - 1) * PAGE_SIZE;

  let query = client
    .from("profiles")
    .select("id, full_name, email, phone, avatar_url, role, staff_role, status, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id")
    .range(from, from + PAGE_SIZE - 1);
  if (filter === "blocked") query = query.eq("status", "blocked");
  else if (filter) query = query.eq("role", filter);
  const term = safeLikeTerm(q);
  if (term) query = query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`);

  const [list, counts, staffRole, customRes] = await Promise.all([
    query, client.rpc("fn_admin_user_counts"), client.from("roles").select("permissions").eq("slug", "staff").maybeSingle(),
    client.from("roles").select("slug, name_ar, name_en, permissions").eq("is_system", false).not("slug", "in", "(admin,staff,vendor,customer)").order("created_at"),
  ]);
  const customRoles = JSON.parse(JSON.stringify(customRes.data ?? [])) as CustomRole[];
  const role = viewer.profile.role;
  const perms = viewer.permissions ?? [];
  if (list.error) throw new Error(list.error.message);
  const profiles = (list.data ?? []) as Array<Omit<UserListRow, "store">>;
  const ids = profiles.map((p) => p.id);
  const [{ data: stores }, unconfirmedRes] = ids.length
    ? await Promise.all([
        client.from("vendors").select("id, owner_id, store_name_ar, store_name_en, hidden_from_listings, status").in("owner_id", ids),
        client.rpc("fn_admin_unconfirmed", { p_ids: ids }),
      ])
    : [{ data: [] }, { data: [] }];
  // accounts that never entered their email code (they exist but can't sign in yet)
  const unconfirmed = new Set(((unconfirmedRes.data ?? []) as string[]));
  const storeByOwner = new Map(((stores ?? []) as Array<Record<string, unknown>>).map((s) => [s.owner_id as string, {
    id: s.id as string, name_ar: s.store_name_ar as string, name_en: s.store_name_en as string,
    hidden: Boolean(s.hidden_from_listings), status: s.status as string,
  }]));
  const privileged = role === "admin";
  return {
    lang, q, filter, page, perPage: PAGE_SIZE, total: list.count ?? 0,
    viewerId: viewer.user.id,
    creatable: creatableRoles(role, perms),
    staffDefaults: ((staffRole.data?.permissions as string[] | undefined) ?? [...DEFAULT_STAFF_PERMISSIONS]),
    allow: {
      block: can(role, perms, "users.block"),
      remove: can(role, perms, "users.delete"),
      role: privileged,
      vendorsSuspend: can(role, perms, "vendors.suspend"),
      roles: privileged,
      privileged,
    },
    /** roles this viewer may hand out (DB enforces the same: only admins touch admin/staff) */
    roleOptions: (privileged ? [...ROLES, ...customRoles.map((r) => r.slug)] : ["customer", "vendor"]) as string[],
    customRoles,
    users: profiles.map((p) => ({ ...p, store: storeByOwner.get(p.id) ?? null, unconfirmed: unconfirmed.has(p.id) })) as UserListRow[],
    counts: (counts.data ?? {}) as Partial<Record<"total" | "vendor" | "customer" | "admin" | "staff" | "blocked", number>>,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  // role changes are admin-only (single and bulk)
  if (form.get("intent") === "role" || (form.get("intent") === "bulk" && form.get("op") === "role")) {
    if (viewer.profile.role !== "admin") throw new Response("Forbidden", { status: 403 });
  }
  if (form.get("intent") === "create") {
    const siteUrl = process.env.SITE_URL?.replace(/\/$/, "") ?? new URL(request.url).origin;
    return createUserFromAdmin(client, viewer, form, { lang, siteUrl });
  }
  return handleUserAction(client, form);
}

type BulkOp = "ban" | "unban" | "delete" | "role";
type Pending =
  | { kind: "ban" | "unban" | "hide_products" | "show_products" | "delete"; user: UserListRow }
  | { kind: "role"; user: UserListRow; role: string }
  | { kind: "bulk"; op: BulkOp; users: UserListRow[] };

const ROLE_STYLE: Record<string, string> = {
  admin: "bg-danger-soft text-danger border-danger/20",
  staff: "bg-info-soft text-info border-info/20",
  vendor: "bg-warning-soft text-warning-strong border-warning/30",
  customer: "bg-surface-tint text-text-muted border-border",
};

export default function AdminUsers({ loaderData }: Route.ComponentProps) {
  const listLoading = useListLoading();
  const { t, i18n } = useTranslation();
  const en = i18n.language?.startsWith("en");
  const { lang, users, counts, filter, q, page, perPage, total, viewerId, creatable, staffDefaults, allow, roleOptions, customRoles } = loaderData;
  // role key: a custom role slug for staff with a sub-role, else the built-in role
  const keyOf = (u: UserListRow) => (u.role === "staff" && u.staff_role ? u.staff_role : u.role);
  const roleName = (key: string) => {
    const c = customRoles.find((r) => r.slug === key);
    return c ? (lang === "en" ? c.name_en || c.name_ar : c.name_ar || c.name_en) : t(`roles.${key}`);
  };
  const styleOf = (key: string) => ROLE_STYLE[baseRole(key) ?? "customer"] ?? ROLE_STYLE.customer;
  const hintOf = (key: string) => (customRoles.some((r) => r.slug === key) ? t("users.roleHint.custom", { name: roleName(key) }) : t(`users.roleHint.${key}`));
  const [createOpen, setCreateOpen] = useState(false);
  const navigate = useNavigate();
  const fetcher = useFetcher<typeof action>();
  useActionToast(fetcher);
  const [pending, setPending] = useState<Pending | null>(null);
  const [bulkRole, setBulkRole] = useState<string>("customer");
  const [text, setText] = useState(q);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkResult, setBulkResult] = useState<{ op: string; done: number; failed: Array<{ id: string; reason: string }> } | null>(null);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data?.ok) return;
    const d = fetcher.data as { intent?: string; op?: string; done?: number; failed?: Array<{ id: string; reason: string }> };
    if (d.intent === "bulk") {
      setBulkResult({ op: d.op ?? "", done: d.done ?? 0, failed: d.failed ?? [] });
      setSelected(new Set((d.failed ?? []).map((f) => f.id)));
    } else setSelected(new Set());
    setPending(null);
  }, [fetcher.state, fetcher.data]);

  // a new page / filter / search clears the selection
  useEffect(() => { setSelected(new Set()); }, [page, filter, q]);

  // debounced search; a new search starts at page 1
  useEffect(() => {
    if (text.trim() === q) return;
    const timer = window.setTimeout(() => {
      const sp = new URLSearchParams();
      if (filter) sp.set("f", filter);
      if (text.trim()) sp.set("q", text.trim());
      navigate(`?${sp.toString()}`, { replace: true, preventScrollReset: true });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [text, q, filter, navigate]);

  const hrefFor = (p: number, f = filter) => {
    const sp = new URLSearchParams();
    if (f) sp.set("f", f);
    if (q) sp.set("q", q);
    if (p > 1) sp.set("page", String(p));
    return `?${sp.toString()}`;
  };

  /** rows this viewer may act on (never yourself; staff/admin only by an admin) */
  // ranks: nobody acts on themselves or on an admin; only admins act on staff (the DB enforces the same)
  const manageable = (u: UserListRow) => u.id !== viewerId && u.role !== "admin" && (allow.privileged || u.role !== "staff");
  const canRole = (u: UserListRow) => allow.role && manageable(u);
  const bulkOn = allow.block || allow.remove || allow.role;
  const selectable = bulkOn ? users.filter(manageable) : [];
  const allSelected = selectable.length > 0 && selectable.every((u) => selected.has(u.id));
  const toggle = (id: string) => setSelected((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectable.map((u) => u.id)));
  const chosen = users.filter((u) => selected.has(u.id));
  const nameOf = (u: UserListRow) => u.full_name || u.email || "?";
  const errText = (reason: string) => t(`users.err.${reason}`, { defaultValue: t("users.err.failed") });
  const storeName = (s: NonNullable<UserListRow["store"]>) => (en ? s.name_en || s.name_ar : s.name_ar || s.name_en);
  const joined = (iso: string) => new Date(iso).toLocaleDateString(en ? "en-GB" : "ar-EG-u-nu-latn", { day: "numeric", month: "short", year: "numeric" });

  const cards: Array<{ key: (typeof FILTERS)[number]; label: string; value: number | undefined; icon: ReactNode; tone: string }> = [
    { key: "", label: t("users.filter_all"), value: counts.total, icon: <UsersIcon className="size-5" />, tone: "bg-surface-tint text-text" },
    { key: "customer", label: t("users.statCustomers"), value: counts.customer, icon: <UserIcon className="size-5" />, tone: "bg-surface-tint text-text-muted" },
    { key: "vendor", label: t("users.statSellers"), value: counts.vendor, icon: <StoreIcon className="size-5" />, tone: "bg-warning-soft text-warning-strong" },
    { key: "staff", label: t("users.statStaff"), value: counts.staff, icon: <SettingsIcon className="size-5" />, tone: "bg-info-soft text-info" },
    { key: "admin", label: t("users.statAdmins"), value: counts.admin, icon: <ShieldIcon className="size-5" />, tone: "bg-danger-soft text-danger" },
    { key: "blocked", label: t("users.filter_blocked"), value: counts.blocked, icon: <XIcon className="size-5" />, tone: "bg-danger-soft text-danger" },
  ];

  const roleCell = (u: UserListRow) => canRole(u) ? (
    <label className="relative inline-flex">
      <span className="sr-only">{t("users.roleFor", { name: nameOf(u) })}</span>
      <select
        value={keyOf(u)}
        onChange={(e) => { if (e.target.value !== keyOf(u)) setPending({ kind: "role", user: u, role: e.target.value }); }}
        className={`cursor-pointer appearance-none rounded-full border py-1 pe-7 ps-3 text-xs font-extrabold transition-shadow hover:shadow-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-action/40 ${styleOf(keyOf(u))}`}
      >
        {(roleOptions.includes(keyOf(u)) ? roleOptions : [keyOf(u), ...roleOptions]).map((r) => (
          <option key={r} value={r}>{roleName(r)}</option>
        ))}
      </select>
      <ChevronRightIcon aria-hidden="true" className="pointer-events-none absolute end-2 top-1/2 size-3 -translate-y-1/2 rotate-90 opacity-70" />
    </label>
  ) : (
    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-extrabold ${styleOf(keyOf(u))}`}>{roleName(keyOf(u))}</span>
  );

  const statusCell = (u: UserListRow) => {
    const state = u.status === "blocked" ? "blocked" : u.unconfirmed ? "unconfirmed" : "active";
    return (
      <span
        title={state === "unconfirmed" ? t("users.unconfirmedHint") : undefined}
        className={`inline-flex items-center gap-1.5 text-xs font-bold ${state === "blocked" ? "text-danger" : state === "unconfirmed" ? "text-warning-strong" : "text-success-strong"}`}
      >
        <span aria-hidden="true" className={`size-2 rounded-full ${state === "blocked" ? "bg-danger" : state === "unconfirmed" ? "bg-warning-strong" : "bg-success"}`} />
        {t(state === "blocked" ? "users.banned" : state === "unconfirmed" ? "users.unconfirmed" : "users.active")}
      </span>
    );
  };

  const storeCell = (u: UserListRow) => u.store ? (
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-sm font-bold text-text">{storeName(u.store)}</span>
      <span className="flex flex-wrap gap-1 text-2xs font-bold">
        <span className="text-text-muted">{t(`users.storeState.${u.store.status}`, { defaultValue: u.store.status })}</span>
        {u.store.hidden ? <span className="text-warning-strong">· {t("users.productsHidden")}</span> : null}
      </span>
    </span>
  ) : <span className="text-text-faint">—</span>;

  const rowMenu = (u: UserListRow) => {
    const items: Array<{ label: string; icon: ReactNode; danger?: boolean; onSelect?: () => void; to?: string }> = [
      { label: t("users.open"), icon: <UserIcon className="size-4" />, to: `/${lang}/admin/users/${u.id}` },
    ];
    if (u.store && allow.vendorsSuspend) items.push({
      label: u.store.hidden ? t("users.showProducts") : t("users.hideProducts"),
      icon: u.store.hidden ? <EyeIcon className="size-4" /> : <EyeOffIcon className="size-4" />,
      onSelect: () => setPending({ kind: u.store!.hidden ? "show_products" : "hide_products", user: u }),
    });
    if (allow.block && manageable(u)) items.push({
      label: u.status === "blocked" ? t("users.unban") : t("users.ban"),
      icon: <ShieldIcon className="size-4" />, danger: u.status !== "blocked",
      onSelect: () => setPending({ kind: u.status === "blocked" ? "unban" : "ban", user: u }),
    });
    if (allow.remove && manageable(u)) items.push({
      label: t("users.delete"), icon: <TrashIcon className="size-4" />, danger: true,
      onSelect: () => setPending({ kind: "delete", user: u }),
    });
    return <RowMenu label={t("users.actionsFor", { name: nameOf(u) })} items={items} />;
  };

  const checkbox = (u: UserListRow) => selectable.length ? (
    <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggle(u.id)}
      disabled={!selectable.includes(u)}
      aria-label={t("users.bulk.selectOne", { name: nameOf(u) })}
      className="size-4 shrink-0 cursor-pointer accent-[var(--color-action)] disabled:cursor-not-allowed disabled:opacity-25" />
  ) : null;

  const identity = (u: UserListRow) => (
    <Link to={`/${lang}/admin/users/${u.id}`} className="group flex min-w-0 items-center gap-3">
      <UserAvatar name={u.full_name || u.email || "?"} path={u.avatar_url} />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-extrabold text-text group-hover:text-action">{u.full_name || t("users.noName")}</span>
          {u.id === viewerId ? <span className="rounded bg-surface-tint px-1.5 text-2xs font-bold text-text-muted">{t("users.you")}</span> : null}
        </span>
        <span className="block truncate text-xs text-text-muted" dir="ltr">{u.email || "—"}</span>
        {u.phone ? <span className="num block truncate text-xs text-text-faint" dir="ltr">{u.phone}</span> : null}
      </span>
    </Link>
  );

  const destructive = pending !== null && (pending.kind === "ban" || pending.kind === "delete" || (pending.kind === "bulk" && (pending.op === "ban" || pending.op === "delete")));
  const isDelete = pending !== null && (pending.kind === "delete" || (pending.kind === "bulk" && pending.op === "delete"));
  const needsReason = pending !== null && (pending.kind === "ban" || pending.kind === "hide_products" || pending.kind === "delete" || (pending.kind === "bulk" && (pending.op === "ban" || pending.op === "delete")));
  const dialogTitle = !pending ? "" : pending.kind === "bulk"
    ? t(`users.bulk.title_${pending.op}`, { count: pending.users.length })
    : pending.kind === "role" ? t("users.roleTitle") : t(`users.confirmTitle_${pending.kind}`);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("admin.users")}
        subtitle={t("users.subtitle")}
        count={counts.total ?? total}
        actions={
          <div className="flex flex-wrap gap-2">
            {allow.roles ? (
              <Link to={`/${lang}/admin/roles`} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-bold text-text hover:border-action hover:text-action">
                <ShieldIcon className="size-4" />{t("users.rolesLink")}
              </Link>
            ) : null}
            {creatable.length ? (
              <Button size="sm" onClick={() => setCreateOpen(true)}><PlusIcon className="size-4" />{t("cu.open")}</Button>
            ) : null}
          </div>
        }
      />

      {/* role cards = filters */}
      <nav aria-label={t("users.filter")} className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {cards.map((c) => {
          const on = filter === c.key;
          return (
            <Link key={c.key || "all"} to={hrefFor(1, c.key)} preventScrollReset aria-current={on ? "page" : undefined}
              className={`flex items-center gap-3 rounded-lg border bg-surface p-3.5 shadow-1 transition-all ${on ? "border-action ring-2 ring-action/15" : "border-border hover:border-action/40 hover:shadow-2"}`}>
              <span aria-hidden="true" className={`grid size-10 shrink-0 place-items-center rounded-lg ${c.tone}`}>{c.icon}</span>
              <span className="min-w-0">
                <span className="block truncate text-xs font-bold text-text-muted">{c.label}</span>
                <span className="num block text-xl font-black leading-tight text-text">{c.value ?? 0}</span>
              </span>
            </Link>
          );
        })}
      </nav>

      {bulkResult ? (
        <div role="status" className={`flex items-start gap-3 rounded-lg border p-3 text-sm ${bulkResult.failed.length ? "border-warning bg-warning-soft" : "border-success bg-success-soft"}`}>
          <div className="flex-1">
            <p className="font-bold text-text">{t("users.bulk.result", { done: bulkResult.done, op: t(`users.bulk.op_${bulkResult.op}`) })}</p>
            {bulkResult.failed.length ? (
              <ul className="mt-1 list-disc ps-5 text-xs text-text-muted">
                {bulkResult.failed.map((f) => {
                  const u = users.find((x) => x.id === f.id);
                  return <li key={f.id}><b className="text-text">{u ? nameOf(u) : f.id.slice(0, 8)}</b> — {errText(f.reason)}</li>;
                })}
              </ul>
            ) : null}
          </div>
          <button type="button" onClick={() => setBulkResult(null)} aria-label={t("common.close")} className="rounded p-1 text-text-muted hover:text-text"><XIcon className="size-4" /></button>
        </div>
      ) : null}

      <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-1">
        {/* toolbar: search + count, turns into the bulk bar when rows are selected */}
        <div className={`flex min-h-16 flex-wrap items-center gap-3 border-b border-border px-4 py-3 ${selected.size ? "bg-action/5" : ""}`}>
          {selectable.length ? (
            <input type="checkbox" checked={allSelected} onChange={toggleAll}
              ref={(el) => { if (el) el.indeterminate = selected.size > 0 && !allSelected; }}
              aria-label={t("users.bulk.selectAll")}
              className="size-4 shrink-0 cursor-pointer accent-[var(--color-action)]" />
          ) : null}
          {selected.size ? (
            <>
              <span className="text-sm font-extrabold text-text">{t("users.bulk.selected", { count: selected.size })}</span>
              <div className="ms-auto flex flex-wrap items-center gap-1.5">
                {allow.role ? (
                  <Button size="sm" variant="outline" onClick={() => { setBulkRole(roleOptions[0] ?? "customer"); setPending({ kind: "bulk", op: "role", users: chosen }); }}>
                    <ShieldIcon className="size-4" />{t("admin.users.changeRole")}
                  </Button>
                ) : null}
                {allow.block ? (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setPending({ kind: "bulk", op: "ban", users: chosen })}>{t("users.ban")}</Button>
                    <Button size="sm" variant="outline" onClick={() => setPending({ kind: "bulk", op: "unban", users: chosen })}>{t("users.unban")}</Button>
                  </>
                ) : null}
                {allow.remove ? (
                  <Button size="sm" className="bg-danger hover:bg-danger" onClick={() => setPending({ kind: "bulk", op: "delete", users: chosen })}>
                    <TrashIcon className="size-4" />{t("users.delete")}
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>{t("users.bulk.clear")}</Button>
              </div>
            </>
          ) : (
            <>
              <label className="relative block min-w-0 flex-1 sm:max-w-sm">
                <span className="sr-only">{t("admin.users.search")}</span>
                <SearchIcon aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
                <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("admin.users.search")}
                  className="w-full rounded-md border border-border bg-surface py-2 ps-9 pe-3 text-sm text-text focus:border-action focus:outline-none" />
              </label>
              <span className="ms-auto text-xs font-bold text-text-muted">{t("users.results", { count: total })}</span>
            </>
          )}
        </div>

        {listLoading ? <ListSkeleton /> : users.length === 0 ? (
          <div className="p-6"><EmptyState title={t("admin.users.empty")} body={t("users.emptyHint")} /></div>
        ) : (
          <>
            {/* desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[860px] text-start">
                <thead>
                  <tr className="border-b border-border bg-surface-tint/50 text-2xs font-extrabold uppercase tracking-wide text-text-muted">
                    {selectable.length ? <th scope="col" className="w-10 px-4 py-2.5"><span className="sr-only">{t("users.bulk.selectAll")}</span></th> : null}
                    <th scope="col" className="px-4 py-2.5 text-start">{t("users.col.user")}</th>
                    <th scope="col" className="px-4 py-2.5 text-start">{t("users.col.role")}</th>
                    <th scope="col" className="px-4 py-2.5 text-start">{t("users.col.store")}</th>
                    <th scope="col" className="px-4 py-2.5 text-start">{t("users.col.status")}</th>
                    <th scope="col" className="px-4 py-2.5 text-start">{t("users.col.joined")}</th>
                    <th scope="col" className="w-12 px-4 py-2.5"><span className="sr-only">{t("users.col.actions")}</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {users.map((u) => (
                    <tr key={u.id} className={`transition-colors ${selected.has(u.id) ? "bg-action/5" : "hover:bg-surface-tint/40"}`}>
                      {selectable.length ? <td className="px-4 py-3">{checkbox(u)}</td> : null}
                      <td className="max-w-[320px] px-4 py-3">{identity(u)}</td>
                      <td className="px-4 py-3">{roleCell(u)}</td>
                      <td className="max-w-[200px] px-4 py-3">{storeCell(u)}</td>
                      <td className="px-4 py-3">{statusCell(u)}</td>
                      <td className="num whitespace-nowrap px-4 py-3 text-xs text-text-muted">{joined(u.created_at)}</td>
                      <td className="px-4 py-3 text-end">{rowMenu(u)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* mobile cards */}
            <ul className="divide-y divide-border md:hidden">
              {users.map((u) => (
                <li key={u.id} className={`flex flex-col gap-3 p-4 ${selected.has(u.id) ? "bg-action/5" : ""}`}>
                  <div className="flex items-start gap-3">
                    {checkbox(u) ? <span className="pt-3">{checkbox(u)}</span> : null}
                    <div className="min-w-0 flex-1">{identity(u)}</div>
                    {rowMenu(u)}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 ps-7">
                    {roleCell(u)}
                    {statusCell(u)}
                    <span className="num text-xs text-text-muted">{joined(u.created_at)}</span>
                  </div>
                  {u.store ? <div className="flex items-center gap-2 ps-7 text-xs"><StoreIcon className="size-3.5 text-text-faint" />{storeCell(u)}</div> : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <Pagination page={page} total={total} perPage={perPage} hrefFor={(p) => hrefFor(p)} />

      <Dialog open={pending !== null} onClose={() => setPending(null)} title={dialogTitle}>
        {pending ? (
          <fetcher.Form method="post" className="flex flex-col gap-4 p-1">
            {pending.kind === "bulk" ? (
              <>
                <input type="hidden" name="intent" value="bulk" />
                <input type="hidden" name="op" value={pending.op} />
                {pending.users.map((u) => <input key={u.id} type="hidden" name="ids" value={u.id} />)}
                <p className="text-sm text-text">{t(`users.bulk.confirm_${pending.op}`, { count: pending.users.length })}</p>
                <ul className="max-h-40 overflow-y-auto rounded-md border border-border bg-surface-tint/50 p-2 text-xs text-text">
                  {pending.users.map((u) => (
                    <li key={u.id} className="flex items-center justify-between gap-2 py-0.5">
                      <span className="truncate">{nameOf(u)} <span className="text-text-muted" dir="ltr">{u.email}</span></span>
                      <span className="shrink-0 text-text-muted">{roleName(keyOf(u))}</span>
                    </li>
                  ))}
                </ul>
                {pending.op === "role" ? (
                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-1 text-sm font-bold text-text">{t("users.newRole")}</legend>
                    <div className="grid grid-cols-2 gap-2">
                      {roleOptions.map((r) => (
                        <label key={r} className={`flex cursor-pointer items-center gap-2 rounded-md border p-2.5 text-sm font-bold ${bulkRole === r ? "border-action bg-action/5 text-text" : "border-border text-text-muted hover:border-action/40"}`}>
                          <input type="radio" name="role" value={r} checked={bulkRole === r} onChange={() => setBulkRole(r)} className="accent-[var(--color-action)]" />
                          {roleName(r)}
                        </label>
                      ))}
                    </div>
                    <p className="text-xs leading-relaxed text-text-muted">{hintOf(bulkRole)}</p>
                  </fieldset>
                ) : null}
              </>
            ) : pending.kind === "role" ? (
              <>
                <input type="hidden" name="intent" value="role" />
                <input type="hidden" name="id" value={pending.user.id} />
                <input type="hidden" name="role" value={pending.role} />
                <div className="flex items-center gap-3 rounded-md border border-border p-3">
                  <UserAvatar name={nameOf(pending.user)} path={pending.user.avatar_url} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-extrabold text-text">{nameOf(pending.user)}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                      <span className={`rounded-full border px-2 py-0.5 font-extrabold ${styleOf(keyOf(pending.user))}`}>{roleName(keyOf(pending.user))}</span>
                      <ChevronRightIcon aria-hidden="true" className="size-3.5 text-text-muted" />
                      <span className={`rounded-full border px-2 py-0.5 font-extrabold ${styleOf(pending.role)}`}>{roleName(pending.role)}</span>
                    </p>
                  </div>
                </div>
                <p className="text-xs leading-relaxed text-text-muted">
                  {pending.user.role === "vendor" && pending.role !== "vendor" && pending.user.store ? t("users.roleHint.leaveVendor") : hintOf(pending.role)}
                </p>
              </>
            ) : (
              <>
                <input type="hidden" name="intent" value={pending.kind} />
                <input type="hidden" name="id" value={pending.user.id} />
                {pending.user.store ? <input type="hidden" name="vendor_id" value={pending.user.store.id} /> : null}
                <p className="text-sm text-text">
                  {t(`users.confirm_${pending.kind}`, { name: nameOf(pending.user), store: pending.user.store ? storeName(pending.user.store) : "" })}
                </p>
              </>
            )}
            {isDelete ? <p className="rounded-md bg-danger-soft p-3 text-xs leading-relaxed text-text">{t("users.deleteWarning")}</p> : null}
            {needsReason ? <Input id="users-reason" name="reason" label={t("users.reason")} /> : null}
            {fetcher.state === "idle" && fetcher.data && !fetcher.data.ok && pending.kind !== "bulk" ? (
              <p role="alert" className="text-sm font-bold text-danger">{errText(String((fetcher.data as { reason?: string }).reason ?? ""))}</p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setPending(null)}>{t("common.cancel")}</Button>
              <Button type="submit" loading={fetcher.state !== "idle"} className={destructive ? "bg-danger hover:bg-danger" : ""}>
                {pending.kind === "bulk" ? t(`users.bulk.btn_${pending.op}`, { count: pending.users.length })
                  : pending.kind === "role" ? t("admin.users.changeRole") : t(`users.confirmBtn_${pending.kind}`)}
              </Button>
            </div>
          </fetcher.Form>
        ) : null}
      </Dialog>

      <CreateUserDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        lang={lang}
        roles={creatable}
        staffDefaults={staffDefaults}
        customRoles={customRoles}
      />
    </div>
  );
}

/** ⋯ actions menu for one row: click / Enter opens, Escape or outside click closes. */
function RowMenu({ label, items }: { label: string; items: Array<{ label: string; icon: ReactNode; danger?: boolean; onSelect?: () => void; to?: string }> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const itemCls = (danger?: boolean) =>
    `flex w-full items-center gap-2.5 px-3 py-2 text-start text-sm font-semibold transition-colors ${danger ? "text-danger hover:bg-danger-soft" : "text-text hover:bg-surface-tint"}`;
  return (
    <div ref={ref} className="relative inline-block">
      <button type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className={`grid size-9 place-items-center rounded-md border transition-colors ${open ? "border-action text-action" : "border-transparent text-text-muted hover:border-border hover:text-text"}`}>
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
      </button>
      {open ? (
        <div role="menu" className="absolute end-0 top-full z-30 mt-1 w-52 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-2">
          {items.map((it, i) => (
            <div key={it.label}>
              {it.danger && i > 0 && !items[i - 1]?.danger ? <div className="my-1 border-t border-border" /> : null}
              {it.to ? (
                <Link role="menuitem" to={it.to} className={itemCls(it.danger)} onClick={() => setOpen(false)}>{it.icon}{it.label}</Link>
              ) : (
                <button role="menuitem" type="button" className={itemCls(it.danger)} onClick={() => { setOpen(false); it.onSelect?.(); }}>{it.icon}{it.label}</button>
              )}
            </div>
          ))}
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
  return <SkeletonTable />;
}
