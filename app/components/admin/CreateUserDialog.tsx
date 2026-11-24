import { PhoneInput } from "~/components/phone/PhoneInput";
import { useEffect, useMemo, useState } from "react";
import { Link, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Button, Dialog, Input } from "~/components/ui";
import { CheckIcon, MailIcon, ShieldIcon, StoreIcon, UserIcon, UsersIcon } from "~/components/ui/icons";
import { ALL_PERMISSIONS, type CustomRole, type Role } from "~/lib/permissions";
import { PermissionMatrix } from "~/components/admin/PermissionMatrix";
import type { CreateUserResult } from "~/features/admin/create-user.server";

const ROLE_ICONS: Record<Role, React.ReactNode> = {
  customer: <UserIcon />, vendor: <StoreIcon />, staff: <UsersIcon />, admin: <ShieldIcon />,
};

/** 14 chars from an unambiguous alphabet, always with a letter and a digit. */
function generatePassword(): string {
  const letters = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const all = letters + digits;
  const buf = new Uint32Array(14);
  crypto.getRandomValues(buf);
  const chars = [...buf].map((n) => all[n % all.length]);
  chars[0] = letters[(buf[0] ?? 0) % letters.length];
  chars[1] = digits[(buf[1] ?? 0) % digits.length];
  return chars.join("");
}

/**
 * Create an account by hand with any role the creator may assign: name,
 * email, optional phone, language, role cards, then either a password set
 * now (optionally emailed) or an invite link the person uses to choose one.
 * Staff can start from the role defaults or a customised permission set.
 */
export function CreateUserDialog({ open, onClose, lang, roles, defaultRole, staffDefaults, customRoles = [] }: {
  open: boolean;
  onClose: () => void;
  lang: string;
  roles: Role[];
  defaultRole?: Role;
  staffDefaults: readonly string[];
  /** roles made in admin → Roles (staff sub-roles); offered when staff may be created */
  customRoles?: CustomRole[];
}) {
  const { t } = useTranslation();
  const fetcher = useFetcher<CreateUserResult>();
  const initialRole = defaultRole && roles.includes(defaultRole) ? defaultRole : roles[0] ?? "customer";
  const [role, setRole] = useState<Role>(initialRole);
  // the chosen custom role (a staff sub-role), "" = a built-in role
  const [custom, setCustom] = useState("");
  const customs = roles.includes("staff") ? customRoles : [];
  const customRole = customs.find((r) => r.slug === custom) ?? null;
  const roleDefaults = customRole ? customRole.permissions : staffDefaults;
  const [method, setMethod] = useState<"password" | "invite">("password");
  const [password, setPassword] = useState("");
  const [customise, setCustomise] = useState(false);
  const baseline = useMemo(() => new Set(roleDefaults), [roleDefaults]);
  const [perms, setPerms] = useState<Set<string>>(() => new Set(staffDefaults));
  const [formKey, setFormKey] = useState(0);
  const [dismissed, setDismissed] = useState<unknown>(null);

  useEffect(() => {
    if (open) { setRole(initialRole); setCustom(""); setMethod("password"); setPassword(""); setCustomise(false); setPerms(new Set(staffDefaults)); setFormKey((k) => k + 1); setDismissed(fetcher.data ?? null); }
    // reset each time the dialog opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const result = fetcher.data && fetcher.data !== dismissed && fetcher.data.intent === "create" ? fetcher.data : null;
  const busy = fetcher.state !== "idle";
  const fe = result && !result.ok ? result.fieldErrors ?? {} : {};
  const success = result?.ok ? result : null;
  const grants = ALL_PERMISSIONS.filter((p) => perms.has(p) && !baseline.has(p));
  const revokes = ALL_PERMISSIONS.filter((p) => !perms.has(p) && baseline.has(p));

  function startOver() {
    setPassword(""); setCustomise(false); setPerms(new Set(roleDefaults)); setFormKey((k) => k + 1);
    setDismissed(fetcher.data ?? null);
  }

  return (
    <Dialog open={open} onClose={onClose} title={t("cu.title")} size="lg">
      {success && fetcher.state === "idle" ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <span aria-hidden className="grid size-12 place-items-center rounded-full bg-success-soft text-success-strong"><CheckIcon width={24} height={24} /></span>
          <h3 className="text-base font-extrabold text-text">{t("cu.doneTitle")}</h3>
          <p className="max-w-md text-sm text-text-muted">
            {method === "invite"
              ? (success.emailed ? t("cu.doneInvite", { email: success.email }) : t("cu.doneInviteNoEmail"))
              : (success.emailed ? t("cu.donePasswordEmailed", { email: success.email }) : t("cu.donePassword"))}
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <Link to={`/${lang}/admin/users/${success.userId}`} onClick={onClose}
              className="inline-flex min-h-10 items-center rounded-md bg-action px-4 text-sm font-bold text-on-action hover:bg-action-hover">
              {t("cu.openProfile")}
            </Link>
            <Button variant="outline" onClick={startOver}>{t("cu.another")}</Button>
          </div>
        </div>
      ) : (
        <fetcher.Form key={formKey} method="post" action={`/${lang}/admin/users`} className="flex flex-col gap-5" noValidate>
          <input type="hidden" name="intent" value="create" />
          <input type="hidden" name="role" value={customRole ? customRole.slug : role} />
          <input type="hidden" name="method" value={method} />
          {role === "staff" && customise ? (
            <>
              {grants.map((p) => <input key={`g${p}`} type="hidden" name="grant" value={p} />)}
              {revokes.map((p) => <input key={`r${p}`} type="hidden" name="revoke" value={p} />)}
            </>
          ) : null}

          <fieldset>
            <legend className="mb-2 text-sm font-bold text-text">{t("cu.role")}</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {roles.map((r) => (
                <button key={r} type="button" aria-pressed={role === r && !customRole} onClick={() => { setRole(r); setCustom(""); setPerms(new Set(staffDefaults)); }}
                  className={`flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-lg border px-2 py-3 text-sm font-bold transition-colors ${
                    role === r && !customRole ? "border-action bg-surface-tint text-action" : "border-border bg-surface text-text hover:border-border-strong"
                  }`}>
                  <span aria-hidden className="text-lg">{ROLE_ICONS[r]}</span>
                  {t(`roles.${r}`)}
                </button>
              ))}
              {customs.map((r) => (
                <button key={r.slug} type="button" aria-pressed={custom === r.slug}
                  onClick={() => { setRole("staff"); setCustom(r.slug); setPerms(new Set(r.permissions)); }}
                  className={`flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-lg border px-2 py-3 text-center text-sm font-bold transition-colors ${
                    custom === r.slug ? "border-action bg-surface-tint text-action" : "border-border bg-surface text-text hover:border-border-strong"
                  }`}>
                  <span aria-hidden className="text-lg"><UsersIcon /></span>
                  <span className="line-clamp-2">{lang === "en" ? r.name_en || r.name_ar : r.name_ar || r.name_en}</span>
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-text-muted">
              {customRole
                ? t("cu.roleHint_custom", { name: lang === "en" ? customRole.name_en : customRole.name_ar, count: customRole.permissions.length })
                : t(`cu.roleHint_${role}`)}
            </p>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <Input name="full_name" label={t("cu.name")} autoComplete="off" required error={fe.full_name ? t("cu.err_name") : undefined} />
            <Input name="email" type="email" label={t("cu.email")} dir="ltr" autoComplete="off" required
              error={fe.email === "email_exists" ? t("cu.err_emailExists") : fe.email ? t("cu.err_email") : undefined} />
            <PhoneInput name="phone" label={t("cu.phone")} hint={t("cu.optional")} error={fe.phone ? t("cu.err_phone") : undefined} />
            <PhoneInput name="phone_alternate" label={t("users.altPhone")} hint={t("cu.optional")}
              error={fe.phone_alternate ? t("cu.err_phone") : undefined} />
            {/* emails and the account default to the panel's current language */}
            <input type="hidden" name="locale" value={lang === "en" ? "en" : "ar"} />
          </div>

          <fieldset>
            <legend className="mb-2 text-sm font-bold text-text">{t("cu.access")}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(["password", "invite"] as const).map((m) => (
                <button key={m} type="button" aria-pressed={method === m} onClick={() => setMethod(m)}
                  className={`rounded-lg border p-3 text-start transition-colors ${
                    method === m ? "border-action bg-surface-tint" : "border-border bg-surface hover:border-border-strong"
                  }`}>
                  <span className="flex items-center gap-2 text-sm font-bold text-text">
                    {m === "invite" ? <MailIcon aria-hidden /> : <ShieldIcon aria-hidden />}
                    {t(`cu.method_${m}`)}
                  </span>
                  <span className="mt-1 block text-xs text-text-muted">{t(`cu.methodHint_${m}`)}</span>
                </button>
              ))}
            </div>
            {method === "password" ? (
              <div className="mt-3 flex flex-col gap-2">
                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <Input name="password" type="password" showPasswordToggle label={t("cu.password")} dir="ltr" autoComplete="new-password"
                      value={password} onChange={(e) => setPassword(e.target.value)}
                      hint={t("auth.register.passwordHint")} error={fe.password ? t("cu.err_password") : undefined} />
                  </div>
                  <Button type="button" variant="outline" className="mb-[22px] shrink-0" onClick={() => setPassword(generatePassword())}>
                    {t("cu.generate")}
                  </Button>
                </div>
                <label className="flex items-center gap-2 text-sm text-text">
                  <input type="checkbox" name="send_details" value="1" className="size-4 accent-[var(--color-action)]" />
                  {t("cu.sendDetails")}
                </label>
              </div>
            ) : null}
          </fieldset>

          {role === "staff" ? (
            <fieldset className="rounded-lg border border-border p-3">
              <legend className="px-1 text-sm font-bold text-text">{customRole ? t("cu.rolePerms", { name: lang === "en" ? customRole.name_en : customRole.name_ar }) : t("cu.staffPerms")}</legend>
              <label className="flex items-center gap-2 text-sm text-text">
                <input type="checkbox" checked={customise} onChange={(e) => setCustomise(e.target.checked)} className="size-4 accent-[var(--color-action)]" />
                {t("cu.customise")}
              </label>
              <p className="mt-1 text-xs text-text-muted">{customise ? t("cu.customiseHint") : customRole ? t("cu.defaultsHint_custom", { name: lang === "en" ? customRole.name_en : customRole.name_ar }) : t("cu.defaultsHint")}</p>
              {customise ? (
                <div className="mt-3 max-h-[45dvh] overflow-y-auto pe-1">
                  <PermissionMatrix value={perms} onChange={setPerms} baseline={baseline} />
                </div>
              ) : null}
            </fieldset>
          ) : null}

          {result && !result.ok && !Object.keys(fe).length ? (
            <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm font-bold text-danger">
              {t(`cu.err_${["forbidden", "not_configured"].includes(result.reason) ? result.reason : "generic"}`)}
            </p>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="ghost" onClick={onClose}>{t("cu.cancel")}</Button>
            <Button type="submit" loading={busy} disabled={busy}>
              {method === "invite" ? t("cu.submitInvite") : t("cu.submit")}
            </Button>
          </div>
        </fetcher.Form>
      )}
    </Dialog>
  );
}
