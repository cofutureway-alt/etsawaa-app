import { data } from "react-router";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "~/lib/supabase/admin";
import { sendEmail } from "~/lib/email/server";
import { getI18n } from "~/lib/i18n/config";
import { passwordSchema } from "~/features/auth/schemas";
import { normalizeEgyptianPhone } from "~/lib/phone";
import { baseRole, creatableRoles, isPermission } from "~/lib/permissions";
import type { Viewer } from "~/lib/auth/guards";

/**
 * Manual user creation from the admin panel (Users → Create user, Roles →
 * Add staff). Two access methods, chosen per account:
 *  - password: auth.admin.createUser with email_confirm=true — usable at once;
 *    optionally emails the login details (template `account_created`).
 *  - invite: auth.admin.generateLink(invite) — the person sets their own
 *    password from the emailed link (template `user_invite`, handled by
 *    /auth/forgot?type=invite).
 * The DB trigger creates the profile as 'customer'; fn_admin_finalize_new_user
 * (running as the creator, so has_permission applies) then sets the role,
 * staff overrides and terms acceptance. Any failure after the auth user exists
 * deletes it again — no half-created accounts.
 */

const createSchema = z.object({
  full_name: z.string().trim().min(2, "name").max(120, "name"),
  email: z.string().trim().toLowerCase().email("email").max(254, "email"),
  phone: z.string().trim().max(30).optional().default(""),
  phone_alternate: z.string().trim().max(30).optional().default(""),
  locale: z.enum(["ar", "en"]).default("ar"),
  // a built-in role or a custom role slug (a staff sub-role)
  role: z.string().refine((v) => baseRole(v) !== null, "role"),
  method: z.enum(["password", "invite"]),
  password: z.string().optional().default(""),
  send_details: z.boolean().default(false),
});

export type CreateUserResult =
  | { ok: true; intent: "create"; userId: string; email: string; emailed: boolean; emailError?: string }
  | { ok: false; intent: "create"; reason: string; fieldErrors?: Record<string, string> };

function fail(reason: string, fieldErrors?: Record<string, string>, status = 400) {
  return data<CreateUserResult>({ ok: false, intent: "create", reason, fieldErrors }, { status });
}

export async function createUserFromAdmin(
  client: SupabaseClient,
  viewer: Viewer,
  form: FormData,
  ctx: { lang: string; siteUrl: string },
) {
  const parsed = createSchema.safeParse({
    full_name: form.get("full_name") ?? "",
    email: form.get("email") ?? "",
    phone: form.get("phone") ?? "",
    phone_alternate: form.get("phone_alternate") ?? "",
    locale: form.get("locale") ?? "ar",
    role: form.get("role") ?? "",
    method: form.get("method") ?? "",
    password: form.get("password") ?? "",
    send_details: form.get("send_details") === "1",
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !fieldErrors[key]) fieldErrors[key] = key;
    }
    return fail("invalid", fieldErrors);
  }
  const input = parsed.data;
  const role = baseRole(input.role)!;
  if (!creatableRoles(viewer.profile.role, viewer.permissions ?? []).includes(role)) return fail("forbidden", undefined, 403);
  // a custom role must exist (and not be a system role)
  let customName: { ar: string; en: string } | null = null;
  if (input.role !== role) {
    const { data: r } = await client.from("roles").select("name_ar, name_en, is_system").eq("slug", input.role).maybeSingle();
    if (!r || r.is_system) return fail("invalid", { role: "role" });
    customName = { ar: r.name_ar as string, en: r.name_en as string };
  }

  let phone: string | null = null;
  if (input.phone) {
    const norm = normalizeEgyptianPhone(input.phone);
    if (!norm.ok) return fail("invalid", { phone: "phone" });
    phone = norm.e164;
  }
  let phoneAlt: string | null = null;
  if (input.phone_alternate) {
    const norm = normalizeEgyptianPhone(input.phone_alternate);
    if (!norm.ok) return fail("invalid", { phone_alternate: "phone" });
    phoneAlt = norm.e164;
  }
  if (input.method === "password") {
    const pw = passwordSchema.safeParse(input.password);
    if (!pw.success) return fail("invalid", { password: "password" });
  }
  const grants = form.getAll("grant").map(String).filter(isPermission);
  const revokes = form.getAll("revoke").map(String).filter(isPermission);

  const admin = getSupabaseAdminClient();
  if (!admin) return fail("not_configured", undefined, 503);

  const metadata = { full_name: input.full_name, phone_e164: phone ?? "", locale: input.locale, created_by_admin: viewer.user.id };
  let userId: string;
  let inviteLink: string | null = null;
  if (input.method === "password") {
    const { data: created, error } = await admin.auth.admin.createUser({
      email: input.email, password: input.password, email_confirm: true, user_metadata: metadata,
    });
    if (error || !created.user) return mapAuthError(error?.message);
    userId = created.user.id;
  } else {
    const { data: link, error } = await admin.auth.admin.generateLink({
      type: "invite", email: input.email, options: { data: metadata },
    });
    if (error || !link.user) return mapAuthError(error?.message);
    userId = link.user.id;
    const hash = link.properties?.hashed_token;
    inviteLink = hash ? `${ctx.siteUrl}/${input.locale}/auth/forgot?type=invite&token_hash=${encodeURIComponent(hash)}` : null;
  }

  const fin = await client.rpc("fn_admin_finalize_new_user", {
    p_user: userId, p_role: input.role, p_full_name: input.full_name, p_phone: phone, p_locale: input.locale,
    p_grants: role === "staff" ? grants : [], p_revokes: role === "staff" ? revokes : [],
  });
  const finOk = !fin.error && (fin.data as { ok?: boolean } | null)?.ok === true;
  if (!finOk) {
    await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    return fail((fin.data as { reason?: string } | null)?.reason ?? "failed", undefined, 400);
  }

  if (phoneAlt) await admin.from("profiles").update({ phone_alternate: phoneAlt }).eq("id", userId);

  // emails — failures are reported, never roll the account back
  let emailed = false;
  let emailError: string | undefined;
  const i18n = getI18n(input.locale);
  const loginUrl = `${ctx.siteUrl}/${input.locale}/auth/login`;
  const vars = {
    name: input.full_name, email: input.email, role: customName ? (input.locale === "en" ? customName.en : customName.ar) : i18n.t(`roles.${role}`),
    site_name: i18n.t("app.name"), site_url: ctx.siteUrl, login_url: loginUrl,
  };
  if (input.method === "invite") {
    if (inviteLink) {
      const res = await sendEmail(admin, { to: input.email, templateKey: "user_invite", locale: input.locale, variables: { ...vars, invite_url: inviteLink } });
      emailed = res.status === "sent";
      if (!emailed) emailError = res.status;
    } else {
      emailError = "no_link";
    }
  } else if (input.send_details) {
    const res = await sendEmail(admin, { to: input.email, templateKey: "account_created", locale: input.locale, variables: { ...vars, password: input.password } });
    emailed = res.status === "sent";
    if (!emailed) emailError = res.status;
  }
  return { ok: true as const, intent: "create" as const, userId, email: input.email, emailed, emailError };
}

function mapAuthError(message: string | undefined) {
  if (message && /already (been )?registered|already exists|email_exists/i.test(message)) {
    return fail("email_exists", { email: "email_exists" });
  }
  if (message && /password/i.test(message)) return fail("invalid", { password: "password" });
  return fail("failed", undefined, 500);
}
