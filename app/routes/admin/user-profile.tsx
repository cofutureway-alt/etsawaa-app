import { useEffect, useState, type ReactNode } from "react";
import type { Route } from "./+types/user-profile";
import { Link, data, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { formatPiastres } from "~/lib/money";
import { ALL_PERMISSIONS, ROLES, can, effectivePermissions, isPermission, type CustomRole } from "~/lib/permissions";
import { PermissionMatrix } from "~/components/admin/PermissionMatrix";
import { Badge, Button, Dialog, EmptyState, Input } from "~/components/ui";
import { Rating } from "~/components/ui/Rating";
import { ChevronRightIcon, EyeIcon, EyeOffIcon } from "~/components/ui/icons";
import { Pagination } from "~/components/ui/Pagination";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonPage } from "~/components/ui/Skeleton";
import { useActionToast } from "~/components/layout/ActionFeedback";
import { UserAvatar } from "~/components/admin/UserAvatar";
import { AchievementIcon } from "~/components/achievements/AchievementIcon";
import { BadgeStrip } from "~/components/achievements/BadgeStrip";
import { AdminVerificationPanel, type AdminDoc, type HistoryRow } from "~/components/admin/AdminVerificationPanel";
import { handleUserAction } from "~/features/admin/users.server";
import { loadUserProfile, type ProfileData } from "~/features/admin/user-profile.server";
import { profileTabs } from "~/features/admin/user-profile.shared";
import { getSupabaseAdminClient } from "~/lib/supabase/admin";
import { looksLikeEmail, normalizeEgyptianPhone } from "~/lib/phone";
import { uploadCustomerImage } from "~/features/account/client";

/**
 * Admin → Users → one user. Sellers: personal, store (categories with
 * per-category commission, level, badges), statistics (orders, delivery
 * rate), orders, withdrawals + wallet ledger, finance. Customers: account
 * and addresses, order history, statistics.
 */

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw data({ reason: "db" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "admin", request);
  const profile = await loadUserProfile(client, params.id ?? "", new URL(request.url));
  if (!profile) throw new Response("Not found", { status: 404 });
  const role = viewer.profile.role;
  const perms = viewer.permissions ?? [];
  // staff profile: the role defaults + this person's additions/removals
  let staffPerms: { defaults: string[]; overrides: Array<{ permission: string; granted: boolean }> } | null = null;
  if (profile.profile.role === "staff") {
    const [r, o] = await Promise.all([
      client.from("roles").select("permissions").eq("slug", profile.profile.staff_role ?? "staff").maybeSingle(),
      client.from("user_permissions").select("permission, granted").eq("user_id", profile.profile.id),
    ]);
    staffPerms = {
      defaults: ((r.data?.permissions as string[] | undefined) ?? []),
      overrides: (o.data ?? []) as Array<{ permission: string; granted: boolean }>,
    };
  }
  const privileged = role === "admin";
  const target = profile.profile.role;
  // roles made in admin → Roles (staff sub-roles)
  const { data: customRes } = await client.from("roles").select("slug, name_ar, name_en, permissions")
    .eq("is_system", false).not("slug", "in", "(admin,staff,vendor,customer)").order("created_at");
  const customRoles = JSON.parse(JSON.stringify(customRes ?? [])) as CustomRole[];
  const allow = {
    // ranks: nobody acts on themselves or on an admin; only admins act on staff
    block: can(role, perms, "users.block") && target !== "admin" && profile.profile.id !== viewer.user.id && (privileged || target !== "staff"),
    suspend: can(role, perms, "vendors.suspend"),
    // roles and per-person permissions are admin-only: staff never change them
    role: privileged && can(role, perms, "users.edit") && target !== "admin" && profile.profile.id !== viewer.user.id,
    roles: (privileged ? [...ROLES, ...customRoles.map((r) => r.slug)] : ["customer", "vendor"]) as string[],
    permissions: privileged && profile.profile.id !== viewer.user.id,
    // the admin can change any account's name, email, phone, password and picture
    account: privileged,
  };
  return { lang, viewerId: viewer.user.id, ...profile, staffPerms, allow, customRoles };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data({ ok: false, reason: "db" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  // role changes and permission edits are the owner's decision only
  if (intent === "role" || intent === "permissions") {
    if (viewer.profile.role !== "admin") throw new Response("Forbidden", { status: 403 });
  }

  if (intent === "edit_account") {
    if (viewer.profile.role !== "admin") throw new Response("Forbidden", { status: 403 });
    return editAccount(client, params.id ?? "", form);
  }
  if (intent === "commission") {
    // empty = back to the category's own rate
    const vendorId = String(form.get("vendor_id") ?? "");
    const categoryId = String(form.get("category_id") ?? "");
    const raw = String(form.get("percent") ?? "").trim();
    if (raw === "") {
      const { error } = await client.from("vendor_commission_overrides").delete().eq("vendor_id", vendorId).eq("category_id", categoryId);
      if (error) return data({ ok: false, reason: error.message }, { status: 400 });
    } else {
      const percent = Number(raw);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) return data({ ok: false, reason: "bad_percent" }, { status: 400 });
      const { error } = await client.from("vendor_commission_overrides")
        .upsert({ vendor_id: vendorId, category_id: categoryId, percent: Math.round(percent * 100) / 100 }, { onConflict: "vendor_id,category_id" });
      if (error) return data({ ok: false, reason: error.message }, { status: 400 });
    }
    await client.rpc("fn_audit", { p_action: "vendor.commission_override", p_entity: "vendors", p_entity_id: vendorId, p_before: null, p_after: { category_id: categoryId, percent: raw || null } });
    return { ok: true as const };
  }
  if (intent === "level") {
    const res = await client.rpc("fn_promote_vendor_level", {
      p_vendor_id: String(form.get("vendor_id") ?? ""), p_to_level: String(form.get("level_id") ?? ""),
      p_reason: String(form.get("reason") ?? "") || null,
    });
    if (res.error) return data({ ok: false, reason: res.error.message }, { status: 400 });
    return { ok: true as const };
  }
  // verification tab — every decision goes through a SECURITY DEFINER rpc
  const vendorId = String(form.get("vendor_id") ?? "");
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data: res, error } = await client.rpc(fn, args);
    if (error) return data({ ok: false, reason: error.message }, { status: 400 });
    const r = res as { ok?: boolean; reason?: string } | null;
    return r && r.ok === false ? data({ ok: false, reason: r.reason ?? "failed" }, { status: 400 }) : { ok: true as const };
  };
  const text = (k: string) => String(form.get(k) ?? "").trim() || null;
  if (intent === "doc_review") {
    return rpc("fn_admin_review_document", { p_doc: String(form.get("doc_id") ?? ""), p_decision: String(form.get("decision") ?? ""), p_reason: text("reason"), p_note: text("note") });
  }
  if (intent === "set_verification") {
    return rpc("fn_admin_set_verification", { p_vendor: vendorId, p_status: String(form.get("status") ?? ""), p_note: text("note") });
  }
  if (intent === "suspend") return rpc("fn_admin_suspend_vendor", { p_vendor: vendorId, p_reason: text("reason") ?? "" });
  if (intent === "reinstate") return rpc("fn_admin_reinstate_vendor", { p_vendor: vendorId, p_note: text("note") });
  if (intent === "permissions") {
    return rpc("fn_admin_set_user_permissions", {
      p_user: params.id ?? "",
      p_grants: form.getAll("grant").map(String).filter(isPermission),
      p_revokes: form.getAll("revoke").map(String).filter(isPermission),
    });
  }
  if (intent === "store_review") {
    return rpc("fn_admin_review_vendor", { p_vendor_id: vendorId, p_decision: String(form.get("decision") ?? ""), p_reason: text("reason") });
  }
  form.set("id", params.id ?? "");
  return handleUserAction(client, form);
}

/**
 * Admin edits another account: name, email, phone, second phone, password and picture.
 * Auth fields (email, password) go through the service role; profile fields are saved
 * to profiles. Empty password = unchanged. Audited without the password.
 */
async function editAccount(client: NonNullable<ReturnType<typeof createSupabaseServerClient>["client"]>, userId: string, form: FormData) {
  const admin = getSupabaseAdminClient();
  if (!admin || !userId) return data({ ok: false, reason: "db" }, { status: 503 });
  const value = (k: string) => String(form.get(k) ?? "").trim();
  const fullName = value("full_name");
  const email = value("email").toLowerCase();
  const password = String(form.get("password") ?? "");
  const avatar = value("avatar_path");
  if (fullName.length < 2) return data({ ok: false, reason: "users.editErrName" }, { status: 400 });
  if (email && !looksLikeEmail(email)) return data({ ok: false, reason: "users.editErrEmail" }, { status: 400 });
  if (password && password.length < 8) return data({ ok: false, reason: "users.editErrPassword" }, { status: 400 });
  const phoneFor = (raw: string) => {
    if (!raw) return { ok: true as const, value: null };
    const p = normalizeEgyptianPhone(raw);
    return p.ok ? { ok: true as const, value: p.e164 } : { ok: false as const, value: null };
  };
  const phone = phoneFor(value("phone"));
  const phone2 = phoneFor(value("phone_alternate"));
  if (!phone.ok || !phone2.ok) return data({ ok: false, reason: "users.editErrPhone" }, { status: 400 });

  const { data: before } = await admin.from("profiles").select("full_name, email, phone, phone_alternate, avatar_url").eq("id", userId).maybeSingle();
  if (!before) return data({ ok: false, reason: "users.editErrMissing" }, { status: 404 });
  if (phone.value && phone.value !== before.phone) {
    const { data: taken } = await admin.from("profiles").select("id").eq("phone", phone.value).neq("id", userId).maybeSingle();
    if (taken) return data({ ok: false, reason: "users.editErrPhoneTaken" }, { status: 400 });
  }
  const authChanges: { email?: string; email_confirm?: boolean; password?: string } = {};
  if (email && email !== String(before.email ?? "").toLowerCase()) Object.assign(authChanges, { email, email_confirm: true });
  if (password) authChanges.password = password;
  if (Object.keys(authChanges).length) {
    const { error } = await admin.auth.admin.updateUserById(userId, authChanges);
    if (error) return data({ ok: false, reason: /already|registered|exists/i.test(error.message) ? "users.editErrEmailTaken" : "users.editErrSave" }, { status: 400 });
  }
  const after = {
    full_name: fullName,
    email: email || before.email,
    phone: phone.value,
    phone_alternate: phone2.value,
    avatar_url: avatar || before.avatar_url,
  };
  const { error } = await admin.from("profiles").update(after).eq("id", userId);
  if (error) return data({ ok: false, reason: /duplicate|unique/i.test(error.message) ? "users.editErrPhoneTaken" : "users.editErrSave" }, { status: 400 });
  await client.rpc("fn_audit", {
    p_action: "user.account_edited", p_entity: "profiles", p_entity_id: userId,
    p_before: before, p_after: { ...after, password_changed: Boolean(password) },
  });
  return { ok: true as const };
}

/** The admin's form for another person's account details. */
function EditAccountDialog({ open, onClose, profile }: {
  open: boolean; onClose: () => void;
  profile: { full_name: string; email: string | null; phone: string | null; phone_alternate: string | null; avatar_url: string | null };
}) {
  const { t } = useTranslation();
  const fetcher = useFetcher<{ ok: boolean; reason?: string }>();
  useActionToast(fetcher);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const busy = uploading || fetcher.state !== "idle";
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) { setFile(null); onClose(); }
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.ok) setError(fetcher.data.reason ?? "users.editErrSave");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    form.delete("avatar");
    if (file) {
      if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) { setError("users.editErrImage"); return; }
      setUploading(true);
      try {
        form.set("avatar_path", (await uploadCustomerImage(file, "media")).path);
      } catch {
        setError("users.editErrImage");
        return;
      } finally {
        setUploading(false);
      }
    }
    fetcher.submit(form, { method: "post" });
  };
  return (
    <Dialog open={open} onClose={onClose} title={t("users.editTitle")}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4 p-1">
        <input type="hidden" name="intent" value="edit_account" />
        <p className="text-sm text-text-muted">{t("users.editHint")}</p>
        {error ? <p role="alert" className="rounded-md border border-danger/40 bg-danger-soft p-3 text-sm font-bold text-danger">{t(error)}</p> : null}
        <div className="flex items-center gap-3">
          <UserAvatar name={profile.full_name || "?"} path={profile.avatar_url} size="lg" />
          <label className="flex flex-col gap-1 text-sm font-bold text-text">
            {t("users.editAvatar")}
            <input name="avatar" type="file" accept="image/*" className="text-sm font-normal" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
        </div>
        <Input name="full_name" label={t("users.editName")} defaultValue={profile.full_name} required />
        <Input name="email" type="email" dir="ltr" label={t("users.editEmail")} defaultValue={profile.email ?? ""} />
        <Input name="phone" type="tel" dir="ltr" label={t("users.editPhone")} defaultValue={profile.phone ?? ""} />
        <Input name="phone_alternate" type="tel" dir="ltr" label={t("users.editPhone2")} defaultValue={profile.phone_alternate ?? ""} />
        <Input name="password" type="password" showPasswordToggle autoComplete="new-password" label={t("users.editPassword")} hint={t("users.editPasswordHint")} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" loading={busy}>{t("users.editSave")}</Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Staff profile: effective permissions = role defaults plus/minus this person's changes. */
function StaffPermissions({ defaults, overrides, canEdit }: {
  defaults: string[]; overrides: Array<{ permission: string; granted: boolean }>; canEdit: boolean;
}) {
  const { t } = useTranslation();
  const fetcher = useFetcher<{ ok: boolean; reason?: string }>();
  useActionToast(fetcher);
  const baseline = new Set(defaults.filter((p) => ALL_PERMISSIONS.includes(p)));
  const [saved, setSaved] = useState(() => new Set(effectivePermissions([...baseline], overrides)));
  const [value, setValue] = useState<Set<string>>(() => new Set(saved));
  const grants = ALL_PERMISSIONS.filter((p) => value.has(p) && !baseline.has(p));
  const revokes = ALL_PERMISSIONS.filter((p) => !value.has(p) && baseline.has(p));
  const changes = ALL_PERMISSIONS.filter((p) => value.has(p) !== saved.has(p)).length;
  const busy = fetcher.state !== "idle";
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) setSaved(new Set(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  return (
    <div id="permissions">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-extrabold text-text">{t("ro.personTitle")}</h2>
          <p className="mt-0.5 text-xs text-text-muted">{t("ro.personHint")}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="info"><span className="num">{t("ro.countOn", { on: value.size, total: ALL_PERMISSIONS.length })}</span></Badge>
          {grants.length ? <Badge tone="success"><span className="num">{t("ro.addedN", { count: grants.length })}</span></Badge> : null}
          {revokes.length ? <Badge tone="danger"><span className="num">{t("ro.removedN", { count: revokes.length })}</span></Badge> : null}
        </div>
      </div>
      <div className="mt-4">
        <PermissionMatrix value={value} onChange={setValue} baseline={baseline} disabled={!canEdit || busy} />
      </div>
      {!canEdit ? <p className="mt-3 text-xs text-text-muted">{t("ro.adminOnly")}</p> : null}
      {canEdit && (changes > 0 || grants.length > 0 || revokes.length > 0) ? (
        <fetcher.Form method="post"
          className="sticky bottom-[calc(var(--bottom-nav-h,0px)+12px)] z-30 mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 shadow-lg">
          <input type="hidden" name="intent" value="permissions" />
          {grants.map((p) => <input key={`g${p}`} type="hidden" name="grant" value={p} />)}
          {revokes.map((p) => <input key={`r${p}`} type="hidden" name="revoke" value={p} />)}
          <p className="text-sm font-bold text-text" aria-live="polite">
            {changes > 0 ? t("ro.unsaved", { count: changes }) : t("ro.personCustom")}
          </p>
          <div className="ms-auto flex flex-wrap gap-2">
            {grants.length || revokes.length ? (
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setValue(new Set(baseline))}>{t("ro.resetToRole")}</Button>
            ) : null}
            {changes > 0 ? (
              <>
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setValue(new Set(saved))}>{t("ro.discard")}</Button>
                <Button type="submit" size="sm" disabled={busy}>{busy ? t("ro.saving") : t("ro.save")}</Button>
              </>
            ) : null}
          </div>
        </fetcher.Form>
      ) : null}
    </div>
  );
}

const WITHDRAW_METHOD: Record<string, string> = { wallet: "wallet.methodWallet", bank: "wallet.methodBank", instapay: "wallet.methodInstapay" };
const WITHDRAW_STATUS: Record<string, string> = { pending: "wd.tabPending", approved: "wd.tabApproved", cancelled: "wd.tabCancelled" };

type Overview = Record<string, unknown> & {
  orders?: number | { total: number; completed: number; cancelled: number; pending: number };
};

export default function AdminUserProfile({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const en = Boolean(i18n.language?.startsWith("en"));
  const d = loaderData as unknown as ProfileData & {
    lang: string; viewerId: string;
    staffPerms: { defaults: string[]; overrides: Array<{ permission: string; granted: boolean }> } | null;
    allow: { block: boolean; suspend: boolean; role: boolean; roles: string[]; permissions: boolean; account: boolean };
    customRoles?: CustomRole[];
  };
  const allow = d.allow;
  const { lang, profile, vendor, tab, overview } = d;
  const money = (p: unknown) => formatPiastres(Number(p ?? 0), en ? "en" : "ar");
  const fetcher = useFetcher<typeof action>();
  useActionToast(fetcher);
  const busy = fetcher.state !== "idle";
  const [confirm, setConfirm] = useState<"ban" | "unban" | "hide_products" | "show_products" | null>(null);
  const currentKey = profile.role === "staff" && profile.staff_role ? profile.staff_role : profile.role;
  const [role, setRole] = useState(currentKey);
  const [editing, setEditing] = useState(false);
  const roleName = (key: string) => {
    const c = (d.customRoles ?? []).find((r) => r.slug === key);
    return c ? (d.lang === "en" ? c.name_en || c.name_ar : c.name_ar || c.name_en) : t(`roles.${key}`);
  };

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) setConfirm(null);
  }, [fetcher.state, fetcher.data]);

  const isSeller = Boolean(vendor);
  // the permissions tab is the admin's alone
  const tabs = profileTabs(isSeller, profile.role).filter((k) => k !== "permissions" || (allow.permissions && d.staffPerms));
  const base = `/${lang}/admin/users/${profile.id}`;
  const storeName = vendor ? String((en ? vendor.store_name_en || vendor.store_name_ar : vendor.store_name_ar || vendor.store_name_en) ?? "") : "";
  const hidden = Boolean(vendor?.hidden_from_listings);
  const level = vendor?.vendor_levels as { name_ar: string; name_en: string; icon: string; color: string } | null | undefined;
  const ov = (overview ?? {}) as Overview;
  const rating = ov.rating as { avg: number | null; count: number } | undefined;
  const sellerOrders = typeof ov.orders === "object" ? ov.orders : null;

  const date = (v: unknown) => (v ? new Date(String(v)).toLocaleDateString(en ? "en-GB" : "ar-EG-u-nu-latn", { year: "numeric", month: "short", day: "numeric" }) : "—");

  return (
    <div className="flex flex-col gap-5">
      <Link to={`/${lang}/admin/users`} className="inline-flex items-center gap-1 self-start text-sm font-bold text-action hover:underline">
        <ChevronRightIcon className="size-4 rotate-180 mirr" />{t("users.backToList")}
      </Link>

      {/* header */}
      <header className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5 shadow-1 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <UserAvatar name={profile.full_name || profile.email || "?"} path={profile.avatar_url} size="lg" />
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 text-xl font-black text-text">
              {profile.full_name || t("users.noName")}
              <Badge tone={profile.role === "admin" ? "danger" : profile.role === "vendor" ? "warning" : "neutral"}>{roleName(currentKey)}</Badge>
              {profile.status === "blocked" ? <Badge tone="danger" dot>{t("users.banned")}</Badge>
                : d.auth && !d.auth.email_confirmed_at ? <Badge tone="warning" dot>{t("users.unconfirmed")}</Badge>
                : <Badge tone="success" dot>{t("users.active")}</Badge>}
            </h1>
            <p className="truncate text-sm text-text-muted" dir="ltr">{[profile.email, profile.phone].filter(Boolean).join(" · ")}</p>
            {vendor ? (
              <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                {level ? <AchievementIcon icon={level.icon} color={level.color} size="xs" title={en ? level.name_en : level.name_ar} /> : null}
                <span className="font-bold text-text">{storeName}</span>
                <Badge tone={vendor.status === "active" ? "success" : "neutral"}>{t(`vendorStates.status.${String(vendor.status)}`)}</Badge>
                {hidden ? <Badge tone="warning">{t("users.productsHidden")}</Badge> : null}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {allow.account ? (
            <Button size="sm" onClick={() => setEditing(true)}>{t("users.editAccount")}</Button>
          ) : null}
          {vendor && allow.suspend ? (
            <Button size="sm" variant="outline" onClick={() => setConfirm(hidden ? "show_products" : "hide_products")}>
              {hidden ? <EyeIcon className="size-4" /> : <EyeOffIcon className="size-4" />}
              {hidden ? t("users.showProducts") : t("users.hideProducts")}
            </Button>
          ) : null}
          {profile.id !== d.viewerId && allow.block ? (
            <Button size="sm" variant={profile.status === "blocked" ? "outline" : "ghost"} className={profile.status === "blocked" ? "" : "text-danger"}
              onClick={() => setConfirm(profile.status === "blocked" ? "unban" : "ban")}>
              {profile.status === "blocked" ? t("users.unban") : t("users.ban")}
            </Button>
          ) : null}
        </div>
      </header>


      {/* headline numbers */}
      {isSeller && sellerOrders ? (
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Kpi label={t("users.kpiCompleted")} value={sellerOrders.completed} />
          <Kpi label={t("users.kpiPending")} value={sellerOrders.pending} />
          <Kpi label={t("users.kpiCancelled")} value={sellerOrders.cancelled} />
          <Kpi label={t("users.kpiDelivery")} value={ov.delivery_rate == null ? "—" : `${ov.delivery_rate}%`} hint={t("users.kpiDeliveryHint")} />
          <Kpi label={t("users.kpiSales")} value={money(ov.gross_sales_piastres)} />
        </dl>
      ) : !isSeller ? (
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label={t("users.kpiOrders")} value={Number(ov.orders ?? 0)} />
          <Kpi label={t("users.kpiSpent")} value={money(ov.spent_piastres)} />
          <Kpi label={t("users.kpiAov")} value={money(ov.avg_order_piastres)} />
          <Kpi label={t("users.kpiLastOrder")} value={date(ov.last_order_at)} />
        </dl>
      ) : null}

      {/* tabs */}
      <nav className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-surface p-1.5 shadow-1" aria-label={t("users.sections")}>
        {tabs.map((key) => (
          <Link key={key} to={key === "personal" ? base : `${base}?tab=${key}`} preventScrollReset aria-current={tab === key ? "page" : undefined}
            className={`shrink-0 rounded-md px-3.5 py-2 text-sm font-bold transition-colors ${tab === key ? "bg-action text-on-action" : "text-text-muted hover:bg-surface-tint hover:text-text"}`}>
            {t(isSeller ? `users.tab_${key}` : `users.ctab_${key}`)}
          </Link>
        ))}
      </nav>

      <section className="rounded-lg border border-border bg-surface p-5 shadow-1">
        {tab === "permissions" && d.staffPerms && allow.permissions ? (
          <StaffPermissions
            key={JSON.stringify(d.staffPerms)}
            defaults={d.staffPerms.defaults}
            overrides={d.staffPerms.overrides}
            canEdit={allow.permissions}
          />
        ) : null}
        {tab === "personal" ? (
          <div className="flex flex-col gap-5">
            <Facts rows={[
              [t("admin.users.name"), profile.full_name || "—"],
              [t("admin.users.email"), <span dir="ltr">{profile.email ?? "—"}</span>],
              [t("admin.users.phone"), <span dir="ltr">{profile.phone ?? "—"}</span>],
              [t("users.altPhone"), <span dir="ltr">{profile.phone_alternate ?? "—"}</span>],
              [t("users.language"), profile.locale === "en" ? "English" : "العربية"],
              [t("users.joined"), date(profile.created_at)],
              [t("users.lastSignIn"), date(d.auth?.last_sign_in_at)],
              [t("users.emailConfirmed"), d.auth?.email_confirmed_at ? t("common.yes") : t("common.no")],
              ...(vendor ? [
                [t("users.ownerName"), `${String(vendor.first_name ?? "")} ${String(vendor.last_name ?? "")}`.trim() || "—"],
                [t("users.storePhone"), <span dir="ltr">{String(vendor.phone ?? "—")}</span>],
              ] as Array<[string, ReactNode]> : []),
            ]} />
            {profile.id !== d.viewerId && allow.role ? (
              <fetcher.Form method="post" className="flex flex-wrap items-end gap-2 border-t border-border pt-4">
                <input type="hidden" name="intent" value="role" />
                <label className="flex flex-col gap-1 text-sm font-bold text-text">
                  {t("admin.users.role")}
                  <select name="role" value={role} onChange={(e) => setRole(e.target.value)}
                    className="rounded-md border border-border bg-surface px-3 py-2 text-sm">
                    {(allow.roles.includes(currentKey) ? allow.roles : [currentKey, ...allow.roles]).map((r) => <option key={r} value={r}>{roleName(r)}</option>)}
                  </select>
                </label>
                <Button type="submit" size="sm" variant="outline" disabled={role === currentKey || busy}>{t("admin.users.changeRole")}</Button>
              </fetcher.Form>
            ) : null}
            {!vendor && d.addresses.length > 0 ? (
              <div className="border-t border-border pt-4">
                <h2 className="mb-2 text-sm font-extrabold text-text">{t("users.addresses")}</h2>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {d.addresses.map((a) => {
                    const gov = a.governorates as { name_ar: string; name_en: string } | null;
                    const area = a.areas as { name_ar: string; name_en: string } | null;
                    return (
                      <li key={String(a.id)} className="rounded-md border border-border p-3 text-sm">
                        <p className="font-bold text-text">{String(a.label || a.full_name || "")} {a.is_default ? <Badge tone="info">{t("users.default")}</Badge> : null}</p>
                        <p className="text-text-muted">{String(a.address1 ?? "")}</p>
                        <p className="text-xs text-text-muted">{[en ? area?.name_en : area?.name_ar, en ? gov?.name_en : gov?.name_ar].filter(Boolean).join("، ")}</p>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === "verification" && vendor ? (
          <AdminVerificationPanel vendorId={String(vendor.id)} status={String(vendor.status)} verification={String(vendor.verification_status)}
            note={(vendor.verification_note as string | null) ?? null} suspension={(vendor.suspension_reason as string | null) ?? null}
            documents={d.documents as AdminDoc[]} history={d.statusHistory as HistoryRow[]} lang={en ? "en" : "ar"} />
        ) : null}

        {tab === "store" && vendor ? (
          <div className="flex flex-col gap-6">
            <Facts rows={[
              [t("users.storeName"), storeName],
              [t("users.slug"), <Link to={`/${lang}/store/${String(vendor.slug)}`} className="text-action hover:underline" dir="ltr">@{String(vendor.slug)}</Link>],
              [t("users.storeStatus"), t(`vendorStates.status.${String(vendor.status)}`)],
              [t("users.verification"), t(`users.verify_${String(vendor.verification_status)}`)],
              [t("users.address"), [vendor.address1, en ? (vendor.areas as { name_en: string } | null)?.name_en : (vendor.areas as { name_ar: string } | null)?.name_ar,
                en ? (vendor.governorates as { name_en: string } | null)?.name_en : (vendor.governorates as { name_ar: string } | null)?.name_ar].filter(Boolean).join("، ") || "—"],
              [t("users.storeSince"), date(vendor.reviewed_at ?? vendor.created_at)],
            ]} />
            <div className="flex flex-wrap gap-2">
              <Link to={`/${lang}/admin/vendors/${String(vendor.id)}`} className="rounded-md border border-border px-3 py-1.5 text-xs font-bold text-text hover:border-action hover:text-action">{t("users.fullStorePage")}</Link>
              <Link to={`/${lang}/admin/vendors/${String(vendor.id)}/edit`} className="rounded-md border border-border px-3 py-1.5 text-xs font-bold text-text hover:border-action hover:text-action">{t("users.editStore")}</Link>
            </div>

            {/* level + badges */}
            <div className="grid gap-4 border-t border-border pt-5 md:grid-cols-2">
              <fetcher.Form method="post" className="flex flex-col gap-2">
                <h2 className="text-sm font-extrabold text-text">{t("users.level")}</h2>
                <input type="hidden" name="intent" value="level" />
                <input type="hidden" name="vendor_id" value={String(vendor.id)} />
                <div className="flex flex-wrap items-end gap-2">
                  <select name="level_id" defaultValue={String(vendor.level_id ?? "")} className="rounded-md border border-border bg-surface px-3 py-2 text-sm">
                    {d.levels.map((l) => <option key={l.id} value={l.id}>{en ? l.name_en : l.name_ar}</option>)}
                  </select>
                  <input name="reason" placeholder={t("users.levelReason")} className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm" />
                  <Button type="submit" size="sm" variant="outline" loading={busy}>{t("users.changeLevel")}</Button>
                </div>
                <p className="text-xs text-text-muted">{t("users.levelHint")}</p>
              </fetcher.Form>
              <div className="flex flex-col gap-2">
                <h2 className="text-sm font-extrabold text-text">{t("bd.title")}</h2>
                {d.badges.length ? <BadgeStrip badges={d.badges} max={10} /> : <p className="text-sm text-text-muted">{t("users.noBadges")}</p>}
              </div>
            </div>

            {/* categories + commission */}
            <div className="border-t border-border pt-5">
              <h2 className="text-sm font-extrabold text-text">{t("users.categories")}</h2>
              <p className="mb-3 text-xs text-text-muted">
                {t("users.commissionHint", { reduction: Number(ov.commission_reduction ?? 0) })}
              </p>
              {d.categories.length === 0 ? (
                <p className="text-sm text-text-muted">{t("users.noCategories")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[620px] text-sm">
                    <thead>
                      <tr className="text-start text-xs text-text-muted">
                        <th className="py-2 text-start font-bold">{t("users.category")}</th>
                        <th className="py-2 text-start font-bold">{t("users.categoryRate")}</th>
                        <th className="py-2 text-start font-bold">{t("users.storeRate")}</th>
                        <th className="py-2 text-start font-bold">{t("users.effectiveRate")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.categories.map((c) => (
                        <tr key={c.id} className="border-t border-border">
                          <td className="py-2.5 font-bold text-text">{en ? c.name_en : c.name_ar}</td>
                          <td className="num py-2.5 text-text-muted">{c.category_rate == null ? "—" : `${c.category_rate}%`}</td>
                          <td className="py-2.5">
                            <fetcher.Form method="post" className="flex items-center gap-1.5">
                              <input type="hidden" name="intent" value="commission" />
                              <input type="hidden" name="vendor_id" value={String(vendor.id)} />
                              <input type="hidden" name="category_id" value={c.id} />
                              <input name="percent" type="number" min={0} max={100} step="0.01" dir="ltr" defaultValue={c.override ?? ""}
                                placeholder={t("users.inherit")} aria-label={t("users.storeRate")}
                                className="w-24 rounded-md border border-border bg-surface px-2 py-1.5 text-sm" />
                              <span className="text-text-muted">%</span>
                              <Button type="submit" size="sm" variant="outline" disabled={busy}>{t("ve.save")}</Button>
                            </fetcher.Form>
                          </td>
                          <td className="num py-2.5 font-black text-action">{c.effective == null ? "—" : `${c.effective}%`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : null}

        {tab === "stats" ? (
          isSeller && sellerOrders ? (
            <div className="grid gap-4 md:grid-cols-2">
              <StatBlock title={t("users.ordersBlock")} rows={[
                [t("users.kpiOrders"), sellerOrders.total],
                [t("users.kpiCompleted"), sellerOrders.completed],
                [t("users.kpiPending"), sellerOrders.pending],
                [t("users.kpiCancelled"), sellerOrders.cancelled],
                [t("users.kpiDelivery"), ov.delivery_rate == null ? "—" : `${ov.delivery_rate}%`],
                [t("users.returns"), Number(ov.returns ?? 0)],
              ]} />
              <StatBlock title={t("users.catalogBlock")} rows={[
                [t("vendorStates.status.approved"), (ov.products as Record<string, number> | undefined)?.approved ?? 0],
                [t("vendorStates.status.pending"), (ov.products as Record<string, number> | undefined)?.pending ?? 0],
                [t("vendorStates.status.draft"), (ov.products as Record<string, number> | undefined)?.draft ?? 0],
                [t("vendorStates.status.rejected"), (ov.products as Record<string, number> | undefined)?.rejected ?? 0],
                [t("users.rating"), rating?.count ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Rating value={rating.avg ?? 0} size="sm" />
                    <span className="num">{rating.avg}</span>
                    <span className="text-text-muted">({rating.count})</span>
                  </span>
                ) : "—"],
              ]} />
            </div>
          ) : (
            <StatBlock title={t("users.activityBlock")} rows={[
              [t("users.kpiOrders"), Number(ov.orders ?? 0)],
              [t("users.kpiCompleted"), Number(ov.completed ?? 0)],
              [t("users.kpiOpen"), Number(ov.open ?? 0)],
              [t("users.kpiCancelled"), Number(ov.cancelled ?? 0)],
              [t("users.kpiSpent"), money(ov.spent_piastres)],
              [t("users.kpiAov"), money(ov.avg_order_piastres)],
              [t("users.returns"), Number(ov.returns ?? 0)],
              [t("users.reviews"), Number(ov.reviews ?? 0)],
              [t("users.wishlist"), Number(ov.wishlist ?? 0)],
              [t("users.addresses"), Number(ov.addresses ?? 0)],
            ]} />
          )
        ) : null}

        {tab === "orders" ? (
          d.orders.length === 0 ? <EmptyState title={t("users.noOrders")} body="" /> : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-sm">
                  <thead>
                    <tr className="text-xs text-text-muted">
                      <th className="py-2 text-start font-bold">{t("users.orderNo")}</th>
                      <th className="py-2 text-start font-bold">{t("users.date")}</th>
                      <th className="py-2 text-start font-bold">{t("admin.users.status")}</th>
                      <th className="py-2 text-start font-bold">{isSeller ? t("users.netItems") : t("users.total")}</th>
                      {isSeller ? <th className="py-2 text-start font-bold">{t("users.commission")}</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {d.orders.map((o) => {
                      const ord = (isSeller ? o.orders : o) as { number: string } | null;
                      return (
                        <tr key={String(o.id)} className="border-t border-border">
                          <td className="py-2.5">
                            {ord ? <Link to={`/${lang}/admin/orders/${ord.number}`} className="font-bold text-action hover:underline" dir="ltr">{ord.number}</Link> : "—"}
                          </td>
                          <td className="py-2.5 text-text-muted">{date(o.created_at)}</td>
                          <td className="py-2.5"><Badge tone={o.status === "delivered" || o.status === "completed" ? "success" : o.status === "cancelled" ? "danger" : "warning"}>{t(`order.status_${String(o.status)}`)}</Badge></td>
                          <td className="num py-2.5 font-bold" dir="ltr">{money(isSeller ? Number(o.items_subtotal_piastres) - Number(o.discount_piastres) : o.total_piastres)}</td>
                          {isSeller ? <td className="num py-2.5 text-text-muted" dir="ltr">{money(o.commission_piastres)}</td> : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination page={d.page} total={d.ordersTotal} perPage={d.perPage} hrefFor={(p) => `${base}?tab=orders${p > 1 ? `&page=${p}` : ""}`} />
            </>
          )
        ) : null}

        {tab === "withdrawals" ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h2 className="mb-2 text-sm font-extrabold text-text">{t("users.withdrawalRequests")}</h2>
              {d.withdrawals.length === 0 ? <p className="text-sm text-text-muted">{t("users.noWithdrawals")}</p> : (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {d.withdrawals.map((w) => (
                    <li key={String(w.id)} className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm">
                      <span className="num font-bold" dir="ltr">{money(w.amount_piastres)}</span>
                      <span className="text-xs text-text-muted">{t(WITHDRAW_METHOD[String(w.method)] ?? "wallet.method")}</span>
                      <Badge tone={w.status === "approved" ? "success" : w.status === "cancelled" ? "neutral" : "warning"}>{t(WITHDRAW_STATUS[String(w.status)] ?? "wd.status")}</Badge>
                      <span className="text-xs text-text-faint">{date(w.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h2 className="mb-2 text-sm font-extrabold text-text">{t("users.ledger")}</h2>
              {d.transactions.length === 0 ? <p className="text-sm text-text-muted">{t("users.noTransactions")}</p> : (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {d.transactions.map((x) => (
                    <li key={String(x.id)} className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm">
                      <span className="min-w-0">
                        <span className="block font-bold text-text">{t(`users.tx_${String(x.type)}`)}</span>
                        <span className="block truncate text-xs text-text-muted" dir="ltr">{String(x.reference ?? "")}</span>
                      </span>
                      <span className={`num font-black ${Number(x.amount_piastres) < 0 ? "text-danger" : "text-success-strong"}`} dir="ltr">{money(x.amount_piastres)}</span>
                      <span className="text-xs text-text-faint">{date(x.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}

        {tab === "finance" ? (
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label={t("users.fAvailable")} value={money((ov.wallet as { available?: number } | null)?.available)} />
            <Kpi label={t("users.fPending")} value={money((ov.wallet as { pending?: number } | null)?.pending)} hint={t("users.fPendingHint")} />
            <Kpi label={t("users.kpiSales")} value={money(ov.gross_sales_piastres)} />
            <Kpi label={t("users.fEarnings")} value={money(ov.earnings_piastres)} />
            <Kpi label={t("users.fCommission")} value={money(ov.commission_piastres)} />
            <Kpi label={t("users.fPenalties")} value={money(ov.penalties_piastres)} />
            <Kpi label={t("users.fWithdrawn")} value={money(ov.withdrawn_piastres)} />
            <Kpi label={t("users.fWithdrawPending")} value={money(ov.withdrawals_pending_piastres)} />
            <Kpi label={t("users.fRateNow")} value={`${Number(ov.commission_now ?? 0)}%`} hint={t("users.fRateNowHint")} />
          </dl>
        ) : null}
      </section>

      {allow.account ? <EditAccountDialog open={editing} onClose={() => setEditing(false)} profile={profile} /> : null}

      <Dialog open={confirm !== null} onClose={() => setConfirm(null)} title={confirm ? t(`users.confirmTitle_${confirm}`) : ""}>
        {confirm ? (
          <fetcher.Form method="post" className="flex flex-col gap-4 p-1">
            <input type="hidden" name="intent" value={confirm} />
            {vendor ? <input type="hidden" name="vendor_id" value={String(vendor.id)} /> : null}
            <p className="text-sm text-text">{t(`users.confirm_${confirm}`, { name: profile.full_name || profile.email || "", store: storeName })}</p>
            {confirm === "ban" || confirm === "hide_products" ? <Input id="profile-reason" name="reason" label={t("users.reason")} /> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setConfirm(null)}>{t("common.cancel")}</Button>
              <Button type="submit" loading={busy} className={confirm === "ban" ? "bg-danger hover:bg-danger" : ""}>{t(`users.confirmBtn_${confirm}`)}</Button>
            </div>
          </fetcher.Form>
        ) : null}
      </Dialog>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-1" title={hint}>
      <dt className="text-xs font-bold text-text-muted">{label}</dt>
      <dd className="num mt-1 text-lg font-black text-text" dir="ltr">{value}</dd>
    </div>
  );
}

function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k} className="flex flex-col gap-0.5 border-b border-border/60 pb-2">
          <dt className="text-xs font-bold text-text-muted">{k}</dt>
          <dd className="text-sm text-text">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function StatBlock({ title, rows }: { title: string; rows: Array<[string, ReactNode]> }) {
  return (
    <div className="rounded-md border border-border">
      <h2 className="border-b border-border px-4 py-2.5 text-sm font-extrabold text-text">{title}</h2>
      <dl className="divide-y divide-border">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between px-4 py-2.5 text-sm">
            <dt className="text-text-muted">{k}</dt>
            <dd className="num font-bold text-text" dir="ltr">{v}</dd>
          </div>
        ))}
      </dl>
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
