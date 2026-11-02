import { useEffect, useState } from "react";
import type { Route } from "./+types/users";
import { data, useFetcher, useRevalidator } from "react-router";
import { useTranslation } from "react-i18next";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { isRole, ROLES, type Role } from "~/lib/permissions";
import { Badge, Button, Card, CardBody, CardHeader, DataTable, Dialog, EmptyState, Select } from "~/components/ui";
import { useToast } from "~/components/ui";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";
import { SkeletonTable } from "~/components/ui/Skeleton";


interface AdminUserRow {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: string;
  status: string;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return { lang, users: null as AdminUserRow[] | null, reason: "db_not_connected" as const };
  await requirePanelAccess(client, lang, "admin", request);
  // RLS allows admin/staff to read all profiles (guests get zero rows).
  const { data, error } = await client
    .from("profiles")
    .select("id, full_name, email, phone, role, status")
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) return { lang, users: null as AdminUserRow[] | null, reason: "query_failed" as const };
  return { lang, users: (data ?? []) as AdminUserRow[], reason: null };
}

type UsersActionData =
  | { ok: true; role: string }
  | { ok: false; reason: "last_admin" | "forbidden" | "db_not_connected" | "generic" };

/**
 * POST role change → REAL RPC `fn_admin_set_role` (SECURITY DEFINER):
 * authorizes the caller, blocks demoting the last admin, updates the row and
 * writes the audit entry with actor + before/after (F-08, US-06).
 */
export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return data<UsersActionData>({ ok: false, reason: "db_not_connected" }, { status: 503 });
  const viewer = await requirePanelAccess(client, lang, "admin", request);
  void viewer;
  const form = await request.formData();
  const userId = String(form.get("userId") ?? "");
  const role = String(form.get("role") ?? "");
  if (!userId || !isRole(role)) return data<UsersActionData>({ ok: false, reason: "generic" }, { status: 400 });

  const { error } = await client.rpc("fn_admin_set_role", { p_user_id: userId, p_new_role: role });
  if (error) {
    if (/last admin/i.test(error.message)) return data<UsersActionData>({ ok: false, reason: "last_admin" });
    if (/permission|not allowed|forbidden/i.test(error.message)) {
      return data<UsersActionData>({ ok: false, reason: "forbidden" });
    }
    return data<UsersActionData>({ ok: false, reason: "generic" });
  }
  return data<UsersActionData>({ ok: true, role });
}

export default function AdminUsers({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { lang, users } = loaderData;
  const toast = useToast();
  const revalidator = useRevalidator();
  const fetcher = useFetcher<UsersActionData>();
  const [target, setTarget] = useState<{ user: AdminUserRow; role: Role } | null>(null);

  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.ok) {
      toast.showToast("success", t("admin.users.roleChanged", { role: fetcher.data.role }));
      setTarget(null);
      void revalidator.revalidate();
    } else if (fetcher.data && !fetcher.data.ok) {
      toast.showToast("error", fetcher.data.reason === "last_admin" ? t("admin.users.lastAdmin") : t("auth.errors.generic"));
    }
  }, [fetcher.data, toast, t, revalidator]);

  if (!users) {
    return <EmptyState title={t("ui.empty.title")} body={t("errors.dataUnavailable")} />;
  }

  return (
    <Card>
      <CardHeader title={`${t("admin.users")} — ${t("admin.users.count", { count: users.length })}`} />
      <CardBody>
        <DataTable<AdminUserRow>
          rows={users}
          rowKey={(row) => row.id}
          columns={[
            { key: "name", header: t("admin.users.name"), render: (row) => row.full_name || "—", text: (row) => row.full_name },
            { key: "email", header: t("admin.users.email"), render: (row) => <span className="num">{row.email ?? "—"}</span>, text: (row) => row.email ?? "" },
            { key: "phone", header: t("admin.users.phone"), render: (row) => <span className="num">{row.phone ?? "—"}</span>, text: (row) => row.phone ?? "" },
            {
              key: "role",
              header: t("admin.users.role"),
              render: (row) => <Badge tone={row.role === "admin" ? "danger" : row.role === "staff" ? "info" : "neutral"}>{row.role}</Badge>,
              text: (row) => row.role,
            },
            {
              key: "status",
              header: t("admin.users.status"),
              render: (row) => <Badge tone={row.status === "active" ? "success" : "warning"}>{row.status}</Badge>,
              text: (row) => row.status,
            },
            {
              key: "actions",
              header: "",
              render: (row) => <RoleCell user={row} lang={lang} busy={busy} onPick={setTarget} />,
              text: () => "",
            },
          ]}
          searchPlaceholder={t("admin.users.search")}
          emptyTitle={t("admin.users.empty")}
          emptyBody={t("admin.users.search")}
          cardTitle={(row) => row.full_name || row.email || row.id}
        />
      </CardBody>

      {/* Confirmation before a destructive/permission-changing action (G4) */}
      <Dialog open={target !== null} onClose={() => setTarget(null)} title={t("admin.users.changeRole")}>
        {target ? (
          <div className="flex flex-col gap-4">
            <p className="text-[13px] text-text-muted">
              {t("admin.users.changeRoleConfirm", { name: target.user.full_name || target.user.email, from: target.user.role, to: target.role })}
            </p>
            <fetcher.Form method="post" className="flex justify-end gap-2">
              <input type="hidden" name="userId" value={target.user.id} />
              <input type="hidden" name="role" value={target.role} />
              <Button variant="ghost" onClick={() => setTarget(null)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" loading={busy}>
                {t("common.confirm")}
              </Button>
            </fetcher.Form>
          </div>
        ) : null}
      </Dialog>
    </Card>
  );
}

function RoleCell({
  user,
  busy,
  onPick,
}: {
  user: AdminUserRow;
  lang: string;
  busy: boolean;
  onPick: (value: { user: AdminUserRow; role: Role } | null) => void;
}) {
  const { t } = useTranslation();
  const [role, setRole] = useState<Role>(isRole(user.role) ? user.role : "customer");
  return (
    <div className="flex items-center gap-2">
      <Select
        label={<span className="sr-only">{t("admin.users.changeRole")}</span>}
        options={ROLES.map((value) => ({ value, label: value }))}
        value={role}
        onChange={(event) => setRole(event.target.value as Role)}
        className="w-28"
      />
      <Button
        size="sm"
        variant="outline"
        disabled={role === user.role || busy}
        onClick={() => onPick({ user, role })}
      >
        {t("admin.users.changeRole")}
      </Button>
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
