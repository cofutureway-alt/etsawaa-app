import { Link, data, useFetcher } from "react-router";
import type { Route } from "./+types/roles";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { ALL_PERMISSIONS, DEFAULT_STAFF_PERMISSIONS, creatableRoles, isPermission } from "~/lib/permissions";
import { Button } from "~/components/ui/Button";
import { Badge } from "~/components/ui/Badge";
import { EmptyState } from "~/components/ui/EmptyState";
import { ShieldIcon, StoreIcon, UserIcon, UsersIcon, PlusIcon } from "~/components/ui/icons";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";
import { PageHeader } from "~/components/layout/PageHeader";
import { PermissionMatrix } from "~/components/admin/PermissionMatrix";
import { CreateUserDialog } from "~/components/admin/CreateUserDialog";
import { UserAvatar } from "~/components/admin/UserAvatar";
import { Dialog } from "~/components/ui/Overlay";

/**
 * Roles & permissions (US-14): the staff role's default permission matrix
 * (grouped, searchable, switch per action) and the staff list with each
 * member's personal additions/removals (edited on their profile). Admin is
 * always full access; sellers and customers have no admin panel. Changes
 * apply on the next request — has_permission() reads the same rows live.
 */

interface RoleRow { slug: string; name_ar: string; name_en: string; permissions: string[]; is_system: boolean }
interface StaffRow {
  id: string; full_name: string; email: string | null; avatar_url: string | null; status: string;
  staff_role: string | null;
  added: number; removed: number;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "admin", request);
  const [roles, staff, admins] = await Promise.all([
    client.from("roles").select("*").order("slug"),
    client.from("profiles").select("id, full_name, email, avatar_url, status, staff_role").eq("role", "staff").order("full_name"),
    client.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin"),
  ]);
  if (roles.error) throw new Error(roles.error.message);
  const staffRows = (staff.data ?? []) as Array<Omit<StaffRow, "added" | "removed">>;
  const { data: overrides } = staffRows.length
    ? await client.from("user_permissions").select("user_id, granted").in("user_id", staffRows.map((s) => s.id))
    : { data: [] };
  const count = (id: string, granted: boolean) =>
    ((overrides ?? []) as Array<{ user_id: string; granted: boolean }>).filter((o) => o.user_id === id && o.granted === granted).length;
  return {
    lang,
    isAdmin: viewer.profile.role === "admin",
    canManage: viewer.profile.role === "admin" || (viewer.permissions ?? []).includes("staff.manage"),
    creatable: creatableRoles(viewer.profile.role, viewer.permissions ?? []),
    roles: JSON.parse(JSON.stringify(roles.data ?? [])) as RoleRow[],
    staff: staffRows.map((s) => ({ ...s, added: count(s.id, true), removed: count(s.id, false) })) as StaffRow[],
    adminCount: admins.count ?? 0,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "permissions");
  const slug = String(form.get("slug") ?? "");
  const ok = (res: { data: unknown; error: { message: string } | null }) => {
    if (res.error) return data({ ok: false, reason: res.error.message }, { status: 500 });
    const r = res.data as { ok: boolean; reason?: string; slug?: string };
    return r.ok ? { ok: true as const, intent, slug: r.slug } : data({ ok: false, reason: r.reason }, { status: 400 });
  };
  if (intent === "create") {
    const perms = [...new Set(form.getAll("perm").map(String).filter(isPermission))];
    return ok(await client.rpc("fn_admin_create_role", { p_name_ar: String(form.get("name_ar") ?? ""), p_name_en: String(form.get("name_en") ?? ""), p_permissions: perms }));
  }
  if (intent === "rename") {
    return ok(await client.rpc("fn_admin_update_role", { p_slug: slug, p_name_ar: String(form.get("name_ar") ?? ""), p_name_en: String(form.get("name_en") ?? "") }));
  }
  if (intent === "delete") return ok(await client.rpc("fn_admin_delete_role", { p_slug: slug }));
  if (intent === "assign") {
    return ok(await client.rpc("fn_admin_set_staff_role", { p_user: String(form.get("user") ?? ""), p_role: slug || "staff" }));
  }
  if (["admin", "vendor", "customer"].includes(slug)) {
    // admin keeps '*'; sellers and customers have no panel permissions
    return data({ ok: false, reason: "system_role" }, { status: 400 });
  }
  const permissions = [...new Set(form.getAll("perm").map(String).filter(isPermission))];
  const res = await client.rpc("fn_admin_set_role_permissions", { p_slug: slug, p_permissions: permissions });
  if (res.error) return data({ ok: false, reason: res.error.message }, { status: 500 });
  const r = res.data as { ok: boolean; reason?: string };
  return r.ok ? { ok: true as const } : data({ ok: false, reason: r.reason }, { status: 400 });
}

type Tab = "roles" | "staff";

export default function AdminRoles({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { lang, roles, staff, isAdmin, adminCount, creatable, canManage } = loaderData;
  const [tab, setTab] = useState<Tab>("roles");
  const [createOpen, setCreateOpen] = useState(false);
  const [newRoleOpen, setNewRoleOpen] = useState(false);
  const staffRole = roles.find((r) => r.slug === "staff");
  const customRoles = roles.filter((r) => !["admin", "staff", "vendor", "customer"].includes(r.slug) && !r.is_system);
  const editable = [...(staffRole ? [staffRole] : []), ...customRoles];
  const [editing, setEditing] = useState<string>("staff");
  const current = editable.find((r) => r.slug === editing) ?? staffRole;
  const memberCount = (slug: string) => staff.filter((s) => (s.staff_role ?? "staff") === slug).length;
  const roleName = (r: RoleRow) => (lang === "ar" ? r.name_ar : r.name_en) || r.slug;

  return (
    <div>
      <PageHeader
        title={t("ro.title")}
        subtitle={t("ro.hint")}
        actions={creatable.includes("staff") ? (
          <Button size="sm" onClick={() => setCreateOpen(true)}><PlusIcon /> {t("ro.addStaff")}</Button>
        ) : undefined}
      />

      <div role="tablist" aria-label={t("ro.title")} className="mt-3 inline-flex rounded-lg border border-border bg-surface-alt p-1">
        {(["roles", "staff"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`min-h-9 rounded-md px-4 text-sm font-bold transition-colors ${
              tab === id ? "bg-surface text-text shadow-sm" : "text-text-muted hover:text-text"
            }`}
          >
            {id === "roles" ? t("ro.tabRoles") : t("ro.tabStaff", { count: staff.length })}
          </button>
        ))}
      </div>

      {tab === "roles" ? (
        <div className="mt-4 flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <RoleSummary icon={<ShieldIcon />} tone="danger" title={t("roles.admin")} body={t("ro.adminSummary")} meta={t("ro.members", { count: adminCount })} />
            <RoleSummary icon={<StoreIcon />} tone="neutral" title={t("roles.vendor")} body={t("ro.vendorSummary")} />
            <RoleSummary icon={<UserIcon />} tone="neutral" title={t("roles.customer")} body={t("ro.customerSummary")} />
          </div>
          {/* staff roles: the default one + custom roles, each with its own permission set */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-2">
            {editable.map((r) => (
              <button key={r.slug} type="button" onClick={() => setEditing(r.slug)} aria-pressed={editing === r.slug}
                className={`inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md px-3 text-sm font-bold transition-colors ${editing === r.slug ? "bg-action text-on-action" : "text-text hover:bg-surface-tint"}`}>
                {r.slug === "staff" ? t("ro.staffTitle") : roleName(r)}
                <span className="num rounded-full bg-black/10 px-1.5 text-2xs">{memberCount(r.slug)}</span>
              </button>
            ))}
            {canManage ? (
              <Button size="sm" variant="outline" className="ms-auto" onClick={() => setNewRoleOpen(true)}><PlusIcon /> {t("ro.newRole")}</Button>
            ) : null}
          </div>
          {current ? <StaffRoleEditor key={current.slug} role={current} canEdit={current.slug === "staff" ? isAdmin : canManage} lang={lang} /> : null}
        </div>
      ) : (
        <StaffList lang={lang} staff={staff} roles={editable} canAssign={canManage} onAdd={creatable.includes("staff") ? () => setCreateOpen(true) : undefined} />
      )}

      <NewRoleDialog open={newRoleOpen} onClose={() => setNewRoleOpen(false)} base={staffRole?.permissions ?? []} onCreated={(slug) => { setNewRoleOpen(false); if (slug) setEditing(slug); }} />

      <CreateUserDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        lang={lang}
        roles={creatable}
        defaultRole="staff"
        staffDefaults={staffRole?.permissions ?? [...DEFAULT_STAFF_PERMISSIONS]}
        customRoles={roles.filter((r) => !r.is_system && !["admin", "staff", "vendor", "customer"].includes(r.slug))}
      />
    </div>
  );
}

function RoleSummary({ icon, tone, title, body, meta }: {
  icon: React.ReactNode; tone: "danger" | "neutral"; title: string; body: string; meta?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center gap-2">
        <span aria-hidden className={`grid size-8 place-items-center rounded-md ${tone === "danger" ? "bg-danger-soft text-danger" : "bg-surface-alt text-text-muted"}`}>{icon}</span>
        <h2 className="text-sm font-extrabold text-text">{title}</h2>
        {meta ? <span className="num ms-auto text-xs text-text-muted">{meta}</span> : null}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-text-muted">{body}</p>
    </div>
  );
}

function NewRoleDialog({ open, onClose, base, onCreated }: { open: boolean; onClose: () => void; base: string[]; onCreated: (slug: string | undefined) => void }) {
  const { t } = useTranslation();
  const fetcher = useFetcher<{ ok: boolean; slug?: string; reason?: string }>();
  const [copy, setCopy] = useState(true);
  useEffect(() => { if (fetcher.state === "idle" && fetcher.data?.ok) onCreated(fetcher.data.slug); }, [fetcher.state, fetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Dialog open={open} onClose={onClose} title={t("ro.newRole")}>
      <fetcher.Form method="post" className="flex flex-col gap-3">
        <input type="hidden" name="intent" value="create" />
        <label className="flex flex-col gap-1 text-sm font-bold text-text">{t("ro.nameAr")}
          <input name="name_ar" required minLength={2} maxLength={60} className="min-h-10 rounded-md border border-border bg-surface px-3 text-sm font-normal" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-bold text-text">{t("ro.nameEn")}
          <input name="name_en" required minLength={2} maxLength={60} dir="ltr" className="min-h-10 rounded-md border border-border bg-surface px-3 text-sm font-normal" />
        </label>
        <label className="flex items-center gap-2 text-sm text-text">
          <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} className="size-4 accent-[var(--color-action)]" />
          {t("ro.copyStaff")}
        </label>
        {copy ? base.filter((p) => p !== "staff.manage").map((p) => <input key={p} type="hidden" name="perm" value={p} />) : null}
        {fetcher.data && !fetcher.data.ok ? <p role="alert" className="text-xs font-bold text-danger">{t("ro.saveFailed")} ({fetcher.data.reason})</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" loading={fetcher.state !== "idle"}>{t("ro.create")}</Button>
        </div>
      </fetcher.Form>
    </Dialog>
  );
}

function StaffRoleEditor({ role, canEdit, lang }: { role: RoleRow; canEdit: boolean; lang: string }) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof action>();
  const saved = useMemo(() => new Set(role.permissions.filter((p) => ALL_PERMISSIONS.includes(p))), [role.permissions]);
  const [value, setValue] = useState<Set<string>>(() => new Set(saved));
  useEffect(() => { setValue(new Set(saved)); }, [saved]);
  const changes = ALL_PERMISSIONS.filter((p) => value.has(p) !== saved.has(p)).length;
  const busy = fetcher.state !== "idle";
  const done = fetcher.state === "idle" && fetcher.data?.ok === true && changes === 0;
  const defaults = new Set<string>(DEFAULT_STAFF_PERMISSIONS);
  const atDefaults = ALL_PERMISSIONS.every((p) => value.has(p) === defaults.has(p));

  return (
    <section className="rounded-lg border border-border bg-surface-alt/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden className="grid size-8 place-items-center rounded-md bg-info-soft text-info"><UsersIcon /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-extrabold text-text">{role.slug === "staff" ? t("ro.staffTitle") : (lang === "ar" ? role.name_ar : role.name_en)}</h2>
          <p className="text-xs text-text-muted">{role.slug === "staff" ? t("ro.staffNote") : t("ro.customNote")}</p>
        </div>
        {role.slug !== "staff" && canEdit ? <RoleAdmin role={role} /> : null}
        <Badge tone="info"><span className="num">{t("ro.countOn", { on: value.size, total: ALL_PERMISSIONS.length })}</span></Badge>
      </div>

      <div className="mt-4">
        <PermissionMatrix value={value} onChange={setValue} disabled={!canEdit || busy} />
      </div>
      {!canEdit ? <p className="mt-3 text-xs text-text-muted">{t("ro.adminOnly")}</p> : null}

      {canEdit && (changes > 0 || done || !atDefaults || (fetcher.data && !fetcher.data.ok)) ? (
        <fetcher.Form
          method="post"
          className="sticky bottom-[calc(var(--bottom-nav-h,0px)+12px)] z-30 mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 shadow-lg"
        >
          <input type="hidden" name="slug" value={role.slug} />
          {[...value].map((p) => <input key={p} type="hidden" name="perm" value={p} />)}
          <p className="text-sm font-bold text-text" aria-live="polite">
            {changes > 0 ? t("ro.unsaved", { count: changes }) : done ? <span className="text-success-strong">{t("ve.saved")}</span> : t("ro.customised")}
          </p>
          {fetcher.data && !fetcher.data.ok ? (
            <p role="alert" className="text-xs font-bold text-danger">{t("ro.saveFailed")}</p>
          ) : null}
          <div className="ms-auto flex flex-wrap gap-2">
            {!atDefaults && role.slug === "staff" ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setValue(new Set(defaults))} disabled={busy}>
                {t("ro.resetDefaults")}
              </Button>
            ) : null}
            {changes > 0 ? (
              <>
                <Button type="button" variant="outline" size="sm" onClick={() => setValue(new Set(saved))} disabled={busy}>
                  {t("ro.discard")}
                </Button>
                <Button type="submit" size="sm" disabled={busy}>{busy ? t("ro.saving") : t("ro.save")}</Button>
              </>
            ) : null}
          </div>
        </fetcher.Form>
      ) : null}
    </section>
  );
}

function RoleAdmin({ role }: { role: RoleRow }) {
  const { t } = useTranslation();
  const fetcher = useFetcher();
  const [renaming, setRenaming] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {renaming ? (
        <fetcher.Form method="post" className="flex flex-wrap gap-1.5" onSubmit={() => setRenaming(false)}>
          <input type="hidden" name="intent" value="rename" />
          <input type="hidden" name="slug" value={role.slug} />
          <input name="name_ar" defaultValue={role.name_ar} className="min-h-9 w-32 rounded-md border border-border bg-surface px-2 text-sm" aria-label={t("ro.nameAr")} />
          <input name="name_en" defaultValue={role.name_en} dir="ltr" className="min-h-9 w-32 rounded-md border border-border bg-surface px-2 text-sm" aria-label={t("ro.nameEn")} />
          <Button type="submit" size="sm">{t("common.save")}</Button>
        </fetcher.Form>
      ) : (
        <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(true)}>{t("ro.rename")}</Button>
      )}
      <fetcher.Form method="post" onSubmit={(e) => { if (!window.confirm(t("ro.deleteConfirm"))) e.preventDefault(); }}>
        <input type="hidden" name="intent" value="delete" />
        <input type="hidden" name="slug" value={role.slug} />
        <Button type="submit" size="sm" variant="ghost" className="text-danger">{t("ro.deleteRole")}</Button>
      </fetcher.Form>
    </div>
  );
}

function StaffList({ lang, staff, roles, canAssign, onAdd }: { lang: string; staff: StaffRow[]; roles: RoleRow[]; canAssign: boolean; onAdd?: () => void }) {
  const { t } = useTranslation();
  const assign = useFetcher();
  if (staff.length === 0) {
    return (
      <div className="mt-4">
        <EmptyState
          title={t("ro.noStaff")}
          body={t("ro.noStaffHint")}
          action={onAdd ? <Button size="sm" onClick={onAdd}><PlusIcon /> {t("ro.addStaff")}</Button> : undefined}
        />
      </div>
    );
  }
  return (
    <ul className="mt-4 divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
      {staff.map((s) => (
        <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
          <UserAvatar name={s.full_name} path={s.avatar_url} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-text">{s.full_name || t("users.noName")}</p>
            <p className="truncate text-xs text-text-muted" dir="ltr">{s.email}</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {s.status === "blocked" ? <Badge tone="danger">{t("users.banned")}</Badge> : null}
            {s.added === 0 && s.removed === 0 ? (
              <Badge tone="neutral">{t("ro.asRole")}</Badge>
            ) : (
              <>
                {s.added > 0 ? <Badge tone="success"><span className="num">{t("ro.addedN", { count: s.added })}</span></Badge> : null}
                {s.removed > 0 ? <Badge tone="danger"><span className="num">{t("ro.removedN", { count: s.removed })}</span></Badge> : null}
              </>
            )}
          </div>
          {canAssign ? (
            <assign.Form method="post">
              <input type="hidden" name="intent" value="assign" />
              <input type="hidden" name="user" value={s.id} />
              <select name="slug" defaultValue={s.staff_role ?? "staff"} aria-label={t("ro.roleOf", { name: s.full_name })}
                onChange={(e) => assign.submit(e.currentTarget.form)}
                className="min-h-9 rounded-md border border-border bg-surface px-2 text-sm font-bold">
                {roles.map((r) => <option key={r.slug} value={r.slug}>{r.slug === "staff" ? t("ro.staffTitle") : (lang === "ar" ? r.name_ar : r.name_en)}</option>)}
              </select>
            </assign.Form>
          ) : null}
          <Link
            to={`/${lang}/admin/users/${s.id}#permissions`}
            className="inline-flex min-h-9 items-center rounded-md border border-border px-3 text-sm font-bold text-text hover:bg-surface-alt"
          >
            {t("ro.manage")}
          </Link>
        </li>
      ))}
    </ul>
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
