# Etsawaa — Remediation Plan (2026-11-04)

This plan is written to be executed **task by task by an implementing model**. Each task gives the evidence, the exact files, the exact change and how to prove it worked. Do the phases in order. Do not skip a task's **Verify** step.

---

## 0. Read this first (rules for the implementer)

### 0.1 Project facts

| Item | Value |
|---|---|
| App root | `H:\z etsawaa\Main App Etsawaa` (all paths below are relative to it) |
| Stack | React Router 7 (SSR, framework mode) · React 19 · TypeScript strict · Supabase (self-hosted) · Tailwind v4 · i18next (ar/en) · zod 4 · `node:test` |
| Database | Self-hosted Supabase at `https://suba.fakarli.com`, Postgres 17 in Docker container `supabase-db` on VPS `80.241.214.57` |
| SSH | `ssh -i ~/.ssh/etsawa_vps root@80.241.214.57` (key auth works; use only the key) |
| Migration folder (local) | `supabase/migrations/` — the last applied one is `20261104000005_admin_users_profiles.sql` |
| Migration folder (VPS) | `/root/etsawaa-migrations/` — `apply.sh` applies every not-yet-recorded `2026*.sql` in order and records it in `supabase_migrations.schema_migrations` |
| Full local gate | `npm run verify` (typecheck + lint + 117 unit tests + build). Must stay green after every phase. |

### 0.2 Hard rules

1. **Never edit an already-applied migration** (anything up to `20261104000005`). Every DB change is a **new** file. Use the numbers given in this plan (`20261105000001`, `…02`, …).
2. **Every migration is wrapped in `begin; … commit;`** like the existing ones.
3. **Never print, log, echo or commit secrets** (`.env` values, JWTs, passwords). Read keys from `.env` inside scripts only.
4. **Never delete data** in the live DB except where a task explicitly says so.
5. Match the surrounding code style: comment density, naming, the `~/` import alias, i18n keys in **both** `app/lib/i18n/ar.ts` and `app/lib/i18n/en.ts` (the test `tests/i18n-keys.test.ts` enforces parity).
6. After each task, run the task's **Verify** step. After each phase, run `npm run verify`.
7. If a step's precondition does not hold (a file or function looks different from what this plan says), **stop and report** instead of improvising.
8. Tasks marked **OWNER** need a human (credentials, accounts, a decision). Do not attempt them; list them in your final report.

### 0.3 How to apply a migration (used by many tasks)

```bash
# 1. copy the new file to the VPS
scp -i ~/.ssh/etsawa_vps "supabase/migrations/<FILE>.sql" root@80.241.214.57:/root/etsawaa-migrations/
# 2. apply (prints "OK <file>" or "FAIL <file>" + error; stops on failure)
ssh -i ~/.ssh/etsawa_vps root@80.241.214.57 "bash /root/etsawaa-migrations/apply.sh"
```

### 0.4 How to run ad-hoc SQL on the live DB (used by Verify steps)

Write the SQL to a local file in your scratch folder, then:

```bash
scp -i ~/.ssh/etsawa_vps check.sql root@80.241.214.57:/tmp/check.sql
ssh -i ~/.ssh/etsawa_vps root@80.241.214.57 "docker exec -i supabase-db psql -U postgres -d postgres -X -q < /tmp/check.sql"
```

To test **as a client role** without changing data, always use a transaction that rolls back:

```sql
begin;
set local role anon;            -- or: authenticated
-- for "authenticated as user X" also run:
-- select set_config('request.jwt.claims', '{"sub":"<user-uuid>","role":"authenticated"}', true);
<statement under test>;
rollback;
```

---

## 1. Summary of findings

Severity: **Critical** = exploitable now by anyone, **High** = exploitable by a signed-in user or blocks a core flow, **Medium** = real defect with limited impact, **Low** = hygiene.

| ID | Severity | Area | Finding (one line) | Phase |
|---|---|---|---|---|
| SEC-01 | ✅ Fixed | DB | Anonymous visitors can UPDATE/INSERT/DELETE categories through the `v_storefront_categories` view (confirmed live) | 1 |
| SEC-02 | ✅ Fixed | DB + app | Anyone can turn a phone number into the account's email (`fn_resolve_email_from_phone` is anon-callable; `/auth/forgot` also echoes the email) — confirmed live | 1 |
| SEC-03 | ✅ Fixed | DB | Vendors can set `featured_permanent`, `featured_until`, `published_at`, `admin_note`, `source`, … on their own draft products by calling PostgREST directly | 1 |
| SEC-04 | **High** | DB | `fn_media_usage` (anon-callable) leaks user names, product names and avatar paths for any storage path | 1 |
| SEC-05 | Medium | DB | 15+ internal/trigger SECURITY DEFINER functions are executable by `anon`/`authenticated` | 1 |
| SEC-06 | Medium | DB tests | `scripts/rls-test-suite.sql` has no assertion for any of SEC-01…05 | 1 |
| OPS-01 | **Critical (ops)** | VPS | Root SSH login **with password** is enabled, and that password was shared in chat | 0 |
| OPS-02 | **Critical (ops)** | Secrets | service_role JWT, anon JWT, VPS password were pasted into chat → must be rotated | 0 |
| OPS-03 | **High** | Process | The project is **not a git repository** — no history, no rollback | 0 |
| CFG-01 | **High** | Auth | GoTrue: `MAILER_AUTOCONFIRM=true`, `SMTP_HOST=supabase-mail` (container does not exist), `SITE_URL=https://suba.fakarli.com` (API host, not the app), `URI_ALLOW_LIST` empty → signup OTP, password-reset and email-change emails can't work | 0/4 |
| CFG-02 | **High** | Email | `RESEND_API_KEY` is empty → no transactional email (welcome, order, payment) is ever sent | 0 |
| CFG-03 | **High** | Payments | No `KASHIER_*` env vars → card payment is unavailable; only COD works | 0 |
| CFG-04 | Medium | Config | `.env` `SITE_URL=http://localhost:3000` → canonical URLs, sitemap, robots, email links all point to localhost in any deployed build | 0 |
| SEC-07 | **High** | App | No rate limit on `register`, `forgot` (password-reset email spam), `contact`, `auth/google` | 2 |
| SEC-08 | Medium | App | `/auth/forgot` intent `reset_new` changes the password of **any** signed-in session without proof of recovery or the current password | 2 |
| SEC-09 | Medium | App | `staff` role gets the whole admin panel (`can()` is never used) but RLS only allows `admin`; staff pages fail, and the email-template "test send" uses the service-role client | 2 |
| SEC-10 | Low | App | Design-system preview `/:lang/ui` is public in production | 2 |
| FUN-01 | Medium | Auth UI | "Continue with Google" button is always shown, but Google is disabled in GoTrue → always errors | 2 |
| FUN-02 | Medium | Contact | Contact messages are stored but **no admin screen reads them**; table also accepts unlimited direct anon inserts with no length limits | 3 |
| FUN-03 | Medium | Payments | `fn_confirm_payment` marks a **cancelled** order as paid without flagging a refund, and skips the amount check when the amount is NULL | 3 |
| FUN-04 | Low | Notifications | `NotificationBell` opens a Supabase Realtime channel from the browser, which has no session (httpOnly cookies) → never fires; polling every 20 s runs even in hidden tabs | 3 |
| FUN-05 | ✅ Fixed | Dead code | Phase-09 staging pipeline (admin Data Import pages, reject-ledger API, `scripts/import-phase09.mjs`, `staging_*` tables) is unused | 5 |
| SEO-01 | Medium | SEO | Sitemap lists all 1,609 categories (1.1 MB), almost all empty; empty category pages are `index, follow` → thin-content pages | 4 |
| SEO-02 | Low | SEO | `robots.txt` does not disallow `/cart`, `/checkout`, `/order`, `/compare`, `/api/` | 4 |
| PERF-01 | ✅ Fixed | Perf | Admin attributes page loads ~1.2 MB in one loader | 4 |
| PERF-02 | Low | Perf | Notification polling + in-memory rate limiter are per-process (documented limitation) | 4 |
| CQ-01 | Low | Quality | 30 oxlint warnings (unused imports/vars) | 5 |
| CQ-02 | Low | Quality | ~60 one-off phase/evidence scripts mixed with live scripts in `scripts/` | 5 |
| REV-01 | Low | Content | 70 Arabic attribute labels were machine-translated during Phase 09 | OWNER |
| UI-01 | **High** | UI | Every auth, account, admin and vendor page (and the product 404) has an **empty `<title>`** — browser tabs show the raw URL | 6 |
| UI-02 | **High** | UI | Every category page says "No results for these filters — you have 1 active" with a "Remove all filters" button, although the visitor set no filter | 6 |
| UI-03 | ✅ Fixed | UI | Admin → Attributes renders all 1,391 product types as one 30,000 px list; on the English UI each card's title is still Arabic | 6 |
| UI-04 | Medium | UI | Product/category/store 404s render a bare card with no header, footer or search (the visitor is stranded) | 6 |
| UI-05 | Medium | UI | Filter sidebar lists every colour (23) and size (39, incl. EU shoe and bed sizes on men's clothing) with count 0 | 6 |
| UI-06 | Medium | UI | Category tiles use first-letter placeholders: in Arabic almost every tile shows "ا" (from "ال…"), in English most show "M" (from "Men's…") | 6 |
| UI-07 | Medium | UI | Category page: title appears twice (two `<h1>`), and the sub-category tiles sit above the breadcrumb | 6 |
| UI-08 | Medium | UI | Pages with no `<h1>`: home, vendors (when no featured stores), cart (empty), compare (empty), admin users, admin logs | 6 |
| UI-09 | Medium | UI | `/vendors` empty state says "try changing the filters" when no filter is set | 6 |
| UI-10 | Medium | UI | `/checkout` with an empty cart shows the "create an account to finish your order — cart items: 0" gate instead of an empty-cart state | 6 |
| UI-11 | ✅ Fixed | UI | An admin opening `/vendor` is forced into the vendor-onboarding wizard (and could create a store on the admin account) | 6 |
| UI-12 | Medium | UI | Admin dashboard shows a permanent green "System operational" badge that checks nothing | 6 |
| UI-13 | Medium | UI | Footer shows a "Kashier" payment badge although card payment is not configured (CFG-03) | 6 |
| UI-14 | Medium | Content | The live "Black Friday" event has a broken Arabic description ("خصومات نوفمبر على-category من الإدارة") and no participating products, but is featured on the home page | OWNER + 6 |
| UI-15 | Low | UI | Mixed numerals: counts show Latin "0", money shows Arabic-Indic "٠٫٠٠ ج.م." on the same admin card row | 6 |
| UI-16 | Low | UI | Panel headers show the raw role slug ("Role: admin" / "الدور: admin") | 6 |
| UI-17 | Low | a11y | Mobile tap targets below 24×24 px: hero carousel dots (8×8), footer links (19 px high), admin category row actions (22×22), terms checkbox (16×16) | 6 |
| UI-18 | Low | a11y | Unnamed controls: admin category-tree expand buttons; unlabeled inputs: admin orders search, customers search, banners image path | 6 |
| UI-19 | Low | UI | Auth pages duplicate the logo and the language switcher (header + card); login placeholder `you@example.com` although the field also accepts a phone | 6 |
| UI-20 | Low | UI | Admin sidebar reuses one "list" icon for 4 items and one "tag" icon for 7 items | 6 |
| UI-21 | Low | Brand | Brand name spelled "اتسوء" in titles/i18n but "إتسوء" in the logo and hero | OWNER |

**Already good (do not change):** RLS enabled on every public table, every SECURITY DEFINER function pins `search_path`, storage buckets have MIME/size limits, CSP/HSTS/X-Frame-Options are sent on every document, Postgres/pooler ports bind to 127.0.0.1 only, the firewall allows only SSH, Studio is behind auth, nightly DB backup cron exists, all 117 unit tests pass, typecheck is clean.

---

## Phase 0 — Owner actions and safety net (do first)

### OPS-03 · Put the project under git (implementer)

**Why:** No version control means no way to review or roll back the changes in this plan.

**Steps**
1. Confirm `.gitignore` in the app root already ignores `.env`, `.env.*.bak`, `node_modules`, `build`. If any is missing, add it.
2. Add a `.gitattributes` with `* text=auto eol=lf` (some SQL files contain CRLF, which leaked `\r` into live function bodies such as `fn_cart_resolve`).
3. `git init`, `git add -A`, then **before committing** run `git status --short | grep -iE "\.env|secret|key"` — it must print nothing except `.env.example`.
4. Commit: `chore: baseline before remediation plan`.
5. Create a branch per phase: `git checkout -b fix/phase-1-db-security`, etc. Commit after each task.

**Verify:** `git log --oneline` shows the baseline commit; `git ls-files | grep -c "^\.env$"` prints `0`.

### OPS-01 · Disable password SSH login — OWNER (or implementer **with owner's explicit OK**)

**Evidence:** `sshd -T` → `permitrootlogin yes`, `passwordauthentication yes`.

**Steps**
1. Confirm key login works in a **second, already-open** session: `ssh -i ~/.ssh/etsawa_vps root@80.241.214.57 echo ok`.
2. On the VPS create `/etc/ssh/sshd_config.d/99-hardening.conf` containing:
   ```
   PasswordAuthentication no
   KbdInteractiveAuthentication no
   PermitRootLogin prohibit-password
   ```
3. `sshd -t && systemctl reload ssh` (Ubuntu service name is `ssh`).
4. Keep the old session open, open a **new** one with the key, and check it works before closing anything.
5. Change the root password (`passwd`) — the old one was shared in chat.

**Verify:** `ssh -i ~/.ssh/etsawa_vps root@80.241.214.57 "sshd -T | grep -E '^(passwordauthentication|permitrootlogin) '"` → `passwordauthentication no`, `permitrootlogin without-password`.

### OPS-02 · Rotate exposed secrets — OWNER

The Supabase JWT secret (which signs the anon and service_role keys), the VPS root password and any other key pasted into chat must be replaced.
1. In `/opt/supabase/.env` (or wherever the docker-compose env lives) generate a new `JWT_SECRET`, regenerate `ANON_KEY` and `SERVICE_ROLE_KEY` from it, and update `DASHBOARD_PASSWORD`.
2. `docker compose up -d` in the Supabase folder to restart with the new values.
3. Put the new anon and service_role keys into the app's `.env` (`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) and rebuild (`npm run build`) — the anon key is baked into the client bundle.
4. Remove the now-unused `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` lines from `.env` (they belonged to the old hosted project).

### CFG-01 · Configure GoTrue (auth emails) — OWNER provides SMTP, implementer edits

**Evidence:** `docker exec supabase-auth env` → `GOTRUE_MAILER_AUTOCONFIRM=true`, `GOTRUE_SMTP_HOST=supabase-mail` (not running), `GOTRUE_SITE_URL=https://suba.fakarli.com`, `GOTRUE_URI_ALLOW_LIST=` (empty).

**Owner provides:** SMTP host/port/user/password/sender (Resend SMTP works: `smtp.resend.com:465`, user `resend`, password = Resend API key) and the app's public URL (e.g. `https://etsawaa.com`).

**Steps (in the Supabase docker `.env` on the VPS)**
1. `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_ADMIN_EMAIL`, `SMTP_SENDER_NAME` = owner values.
2. `ENABLE_EMAIL_AUTOCONFIRM=false` (only after SMTP is confirmed working — otherwise nobody can sign up).
3. `SITE_URL=<app public URL>`.
4. `ADDITIONAL_REDIRECT_URLS=<app URL>/ar/auth/verify,<app URL>/en/auth/verify,<app URL>/ar/auth/forgot,<app URL>/en/auth/forgot,<app URL>/ar/auth/callback/google,<app URL>/en/auth/callback/google`.
5. Make the signup/recovery templates send a **6-digit code** (the app's verify and forgot screens accept `^\d{6}$`): set `MAILER_TEMPLATES_CONFIRMATION` / `MAILER_TEMPLATES_RECOVERY` / `MAILER_TEMPLATES_EMAIL_CHANGE` to hosted HTML templates that print `{{ .Token }}`, or edit the default templates the same way.
6. `docker compose up -d auth`.

**Verify:** register a throw-away account in the running app → an email with a 6-digit code arrives → entering it signs in. Then delete that test user via Studio.

### CFG-02 · Transactional email key — OWNER

Set `RESEND_API_KEY=<key>` and a verified sender domain in `EMAIL_FROM` in the app `.env`. **Verify:** Admin → Email templates → "Send test" for `welcome` shows `sent` and the row in `email_logs` has `status = 'sent'`.

### CFG-03 · Kashier card payments — OWNER

Set `KASHIER_MERCHANT_ID`, `KASHIER_HMAC_SECRET`, `KASHIER_MODE` (`test` first), optionally `KASHIER_BASE_URL`. In the Kashier dashboard set the webhook URL to `<app URL>/api/webhooks/kashier`. **Verify:** a test-mode order with a Kashier test card ends with `orders.payment_status = 'paid'`.

### CFG-04 · Production `SITE_URL` — OWNER at deploy time

`.env` has `SITE_URL=http://localhost:3000`. Set it to the public URL on the production host and also set `TRUSTED_PROXY_HOPS` to the number of reverse proxies in front of Node (usually `1`). **Verify:** `curl -s <app>/robots.txt | tail -1` prints the public sitemap URL.

---

## Phase 1 — Database security (one migration + tests)

SEC-01 and SEC-02 are **already fixed** (2026-11-04, migration `20261104000000_close_view_writes_and_phone_lookup.sql`, applied and verified live — see `06-fix-log.md`). Do not redo them.

The rest of Phase 1 (SEC-03, SEC-04, SEC-05) goes into **one new file**: `supabase/migrations/20261105000001_security_hardening.sql`. Build it section by section (1d–1e; 1c/SEC-03 is already applied — skip it), apply it once, then run every Verify step.

### SEC-01 · Revoke client write access on all views — ✅ DONE

All INSERT/UPDATE/DELETE/TRUNCATE grants on `public` views were revoked from `anon`/`authenticated`, and `alter default privileges for role postgres in schema public revoke insert, update, delete, truncate on tables from anon, authenticated` stops new relations inheriting them. **Consequence for every later migration in this plan:** a new table that clients must write to needs an explicit `grant insert/update/delete … to authenticated` (FUN-02 already does this). Verified: anon `PATCH /rest/v1/v_storefront_categories` → 42501; storefront reads unchanged.

### SEC-02 · Phone → email lookup — ✅ DONE

`fn_resolve_email_from_phone` is executable by `service_role` only. The app calls it through `app/features/auth/phone-email.server.ts` (`resolveEmailFromPhone`) from `login.tsx` (after the rate-limit check) and `forgot.tsx`. `forgot.tsx` no longer returns the email: the code step round-trips the **identifier the user typed** in a hidden `identifier` field and the server resolves it again. Still open from this area: rate limiting of `forgot.tsx` (SEC-07) and the "phone has no registered email" message, which still reveals whether a phone is registered (accepted for now; revisit with SEC-07).

### SEC-03 · Vendor can write privileged product columns — ✅ DONE (in `20261104000003`; skip section 1c)

**Evidence:** `authenticated` has table-level `UPDATE` on `products` (all 33 columns). Policy `products_update_own` only checks ownership and `status in ('draft','rejected')`. A vendor can PATCH their own draft with `featured_permanent=true`, `featured_until='2099-01-01'`, `published_at`, `admin_note`, `rejection_reason`, `source`, `event_hidden`, `submitted_at`, `search_tsv`, `created_at`, then submit it; the flags survive admin approval → free "featured" placement (a paid ad product). The same holds for `INSERT` (policy only forces `status = 'draft'`).

All legitimate vendor writes already go through SECURITY DEFINER RPCs (`fn_save_product`, `fn_submit_product`, `fn_clone_product`, `fn_archive_product`), which run as `postgres`. So the guard can key on `current_user`.

**Section 1c of the migration:**
```sql
-- SEC-03: direct client writes (role "authenticated") may not touch columns
-- owned by the platform. Vendor RPCs run as the function owner and admins are
-- exempt, so both paths are unaffected.
create or replace function public.fn_products_guard_privileged()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if current_user <> 'authenticated' or public.is_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.featured_permanent := false;
    new.featured_until     := null;
    new.event_hidden       := false;
    new.published_at       := null;
    new.submitted_at       := null;
    new.rejection_reason   := null;
    new.admin_note         := null;
    new.source             := 'vendor';
    new.deleted_at         := null;
    new.created_at         := now();
  else
    new.featured_permanent := old.featured_permanent;
    new.featured_until     := old.featured_until;
    new.event_hidden       := old.event_hidden;
    new.published_at       := old.published_at;
    new.submitted_at       := old.submitted_at;
    new.rejection_reason   := old.rejection_reason;
    new.admin_note         := old.admin_note;
    new.source             := old.source;
    new.created_at         := old.created_at;
    new.vendor_id          := old.vendor_id;
  end if;
  return new;
end
$function$;

drop trigger if exists trg_products_guard_privileged on public.products;
create trigger trg_products_guard_privileged
  before insert or update on public.products
  for each row execute function public.fn_products_guard_privileged();
```

**Verify**
1. Pick (or create through the vendor UI) a draft product owned by a test vendor. As that vendor (see §0.4 `request.jwt.claims`), in a rolled-back transaction:
   ```sql
   update public.products set featured_permanent = true, admin_note = 'x' where id = '<draft id>' returning featured_permanent, admin_note;
   ```
   → returns `false`, `NULL`.
2. As postgres with `select set_config('request.jwt.claims', '{"sub":"<admin uuid 945d86a4-0f9b-46c9-ad2a-b78613dca9cc>","role":"authenticated"}', true); set local role authenticated;` the same update returns `true`, `x` (admin exempt). Roll back.
3. Run the existing catalog e2e (the vendor product wizard, save → submit, admin approve) — it must still pass. The script used last time is the scratchpad `e2e-catalog.mjs` pattern; if not available, do the flow by hand in the browser: create product, add colour × size variants, submit, approve as admin, product appears on the storefront.

### SEC-04 · `fn_media_usage` leaks names — High

**Evidence:** executable by `anon`; returns profile `full_name`, product names, vendor store names for any path. The app only calls it from `app/features/media/server-api.ts:123` with the signed-in user's client, to check whether a file the user owns (or an admin) is in use before deleting.

**Section 1d of the migration** — keep the exact same result columns and union, add an access check, and convert to plpgsql:
```sql
-- SEC-04: usage lookup only for an admin or the owner of that media file.
create or replace function public.fn_media_usage(p_path text)
returns table(ref_type text, ref_label text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not (public.is_admin()
          or exists (select 1 from public.media_files f
                     where f.path = p_path and f.owner_id = auth.uid())) then
    return;   -- nothing visible to this caller
  end if;
  return query
  <PASTE THE EXISTING UNION BODY HERE, unchanged, ending with "limit 50">;
end
$function$;

revoke execute on function public.fn_media_usage(text) from public, anon;
grant execute on function public.fn_media_usage(text) to authenticated;
```
Get the existing union body with `select pg_get_functiondef('public.fn_media_usage'::regproc);` and paste the `select … limit 50` part verbatim (it starts with `select 'category' as ref_type`). Inside plpgsql, `ref_type`/`ref_label` are also output parameters; if Postgres reports "column reference is ambiguous", add `#variable_conflict use_column` as the first line after `as $function$`. Do not rename anything.

**Verify**
- As anon: `select * from public.fn_media_usage('anything')` → permission denied.
- As a non-owner authenticated user: returns 0 rows for a path owned by someone else.
- In the app: Admin → Media → try to delete a file used as a category thumbnail → the "in use" toast still appears.

### SEC-05 · Revoke client EXECUTE on internal functions — Medium

**Evidence:** these SECURITY DEFINER functions are executable by `anon` and/or `authenticated` but are only called by triggers, other SECURITY DEFINER functions, or cron (verified by grep in `app/`, `supabase/functions/` and the migrations). Nested calls from a SECURITY DEFINER function run as `postgres`, so revoking client EXECUTE does not break them. Trigger functions never need EXECUTE for the client.

**Section 1e of the migration:**
```sql
-- SEC-05: internal helpers — not part of the client API.
do $$
declare f text;
begin
  foreach f in array array[
    'public.audit_row_change()',
    'public.fn_audit_row()',
    'public.fn_audit_catalog()',
    'public.fn_wallet_apply_tx()',
    'public.handle_new_user()',
    'public.handle_user_email_change()',
    'public.settings_before_write()',
    'public.fn_products_guard_privileged()',
    'public.fn_recently_viewed_prune(uuid)',
    'public.fn_post_earnings(uuid)',
    'public.fn_post_pickup_fee(uuid)',
    'public.fn_auto_levels()',
    'public.fn_cart_resolve(uuid)',
    'public.fn_effective_commission(uuid)',
    'public.fn_vendor_effective_commission(uuid, uuid)',
    'public.c_scope_ok(uuid, jsonb)'
  ] loop
    if to_regprocedure(f) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', f);
    else
      raise notice 'SEC-05: % not found — skipped', f;
    end if;
  end loop;
end $$;

-- Admin-only / signed-in-only RPCs never need anon.
revoke execute on function public.fn_admin_withdrawal_decision(uuid, text, text) from public, anon;
revoke execute on function public.fn_bootstrap_profile() from public, anon;
```

**Do NOT revoke** (used by RLS policies, storefront search or the app as anon): `is_admin`, `has_permission`, `current_role_slug`, `own_vendor_id`, `product_is_public`, `product_owned_or_admin`, `is_public_setting`, `fn_refund_*`, `fn_search_products`, `fn_search_suggestions`, `fn_search_did_you_mean`, `fn_tsv_match`, `fn_storefront_facet_defs`, `fn_vendor_config`, `vendor_can_sell`, `fn_attr_in_template`, `fn_product_slug`, `fn_vendor_slug`.

Before applying, double-check each name in the revoke list is not called from the app:
```bash
grep -rn "fn_cart_resolve\|fn_effective_commission\|fn_vendor_effective_commission\|c_scope_ok\|fn_auto_levels\|fn_post_earnings\|fn_post_pickup_fee\|fn_recently_viewed_prune" app supabase/functions
```
→ must print nothing. If something prints, remove that function from the revoke list and report it.

**Verify:** the query below returns **no** row from the revoke list:
```sql
select p.proname from pg_proc p
where p.pronamespace = 'public'::regnamespace and p.prosecdef
  and has_function_privilege('anon', p.oid, 'execute') order by 1;
```
Then smoke-test as a real user in the app: add to cart, apply a coupon, place a COD order, mark the vendor group delivered as admin (earnings posting runs), view recently-viewed. All must work.

### SEC-06 · Lock these in with RLS regression assertions

Open `scripts/rls-test-suite.sql`, read how existing assertions are written (they `set local role` and raise on failure), and append assertions in the same style:

1. anon `update public.v_storefront_categories … where false` raises `insufficient_privilege` (42501).
2. anon and authenticated cannot execute `fn_resolve_email_from_phone`.
3. anon cannot execute `fn_media_usage`.
4. No SECURITY DEFINER function in the SEC-05 list is anon-executable (use the query from SEC-05's Verify; assert it returns none of those names).
5. No view in `public` grants INSERT/UPDATE/DELETE to anon or authenticated:
   ```sql
   select count(*) from information_schema.role_table_grants g
   join pg_class c on c.relname = g.table_name and c.relnamespace = 'public'::regnamespace
   where g.table_schema = 'public' and c.relkind = 'v'
     and g.grantee in ('anon','authenticated') and g.privilege_type in ('INSERT','UPDATE','DELETE');
   -- must be 0
   ```
6. The SEC-03 trigger exists: `select 1 from pg_trigger where tgname = 'trg_products_guard_privileged'`.

Update the suite's header comment with the new assertion count.

**Verify:** run the suite on the VPS (§0.4). All assertions (14 old + 6 new = 20) pass.

---

## Phase 2 — Application security

### SEC-07 · Rate-limit the remaining public POST endpoints — High

**Evidence:** `grep -rln "rateLimit\|isRateLimited\|recordHit" app/routes` lists only `api/coupon.ts`, `auth/login.tsx`, `auth/verify.tsx`. `register`, `forgot`, `contact` and `auth/google` have none, so anyone can trigger unlimited password-reset or signup emails (costs money, gets the sender domain blocked) and flood `contact_messages`.

**Helpers to reuse:** `app/lib/rate-limit.server.ts` exports `rateLimit`, `isRateLimited`, `recordHit`, `clientKey(request): string | null`. Read the file and copy the usage pattern from `app/routes/auth/verify.tsx` (per-email + per-IP when `clientKey` is non-null).

**Changes**
| Route | Limit | Key(s) | Error returned |
|---|---|---|---|
| `app/routes/auth/forgot.tsx` (intent `send`) | 3 per 15 min per identifier (lower-cased email or E.164 phone); 20 per 15 min per IP | `forgot:id:<identifier>`, `forgot:ip:<ip>` | `formError: "rate_limited"` |
| `app/routes/auth/forgot.tsx` (intent `reset_code`) | 5 per 15 min per identifier | `forgot-code:<identifier>` | `formError: "rate_limited"` |
| `app/routes/auth/register.tsx` | 5 per hour per IP; 3 per hour per email | `register:ip:<ip>`, `register:email:<email>` | `formError: "rate_limited"` |
| `app/routes/contact.tsx` | 3 per 10 min per IP; 10 per hour per email | `contact:ip:<ip>`, `contact:email:<email>` | `reason: "rate_limited"` |
| `app/routes/auth/google.ts` | 20 per 10 min per IP | `google:ip:<ip>` | redirect to login with `?error=rate_limited` |

Rules: check the limit **before** any Supabase call; when `clientKey()` returns `null` (proxy not trusted) skip only the IP limit, keep the identifier limit. Return HTTP 429 via `data(…, { status: 429 })`.

Add i18n keys (both `ar.ts` and `en.ts`): `auth.forgot.rateLimited`, `auth.register.rateLimited`, `contact.errors.rateLimited` (look at the existing `auth.login.rateLimited` wording and reuse its tone). Wire each new error code into the page's `FORM_ERRORS`/reason→message map.

**Tests:** extend `tests/rate-limit.test.ts` only if you add a new helper; otherwise none needed.

**Verify:** with the server running, POST the forgot form 4 times with the same email within a minute → the 4th response is 429 with the rate-limited message (use `curl -X POST -H "sec-fetch-mode: cors" -d "intent=send&identifier=a@b.co" http://localhost:3000/en/auth/forgot?_data` style requests, or the browser).

### SEC-08 · Require recovery proof for "set new password" — Medium

**Evidence:** `app/routes/auth/forgot.tsx` intent `reset_new` calls `client.auth.updateUser({ password })` for whatever session the request carries. Any signed-in session (shared computer, stolen cookie) can change the password without the current password.

**Change**
1. Find where the recovery link/code establishes the session: in `forgot.tsx` the `reset_code` branch (`verifyOtp({ type: "recovery" })`) and, for the email-link flow, the loader handling `type=recovery`/`code` (grep `recovery` in `app/routes/auth/`).
2. At each of those points, after a successful verification, append a short-lived httpOnly cookie to the response headers:
   ```ts
   headers.append("Set-Cookie", `pw_recovery=1; Path=/; Max-Age=900; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
   ```
3. In the `reset_new` branch: if the request's `Cookie` header does not contain `pw_recovery=1`, return `formError: "recovery_failed"` (key already exists → `auth.verify.expired`). After a successful `updateUser`, clear it (`pw_recovery=; Max-Age=0; Path=/`).
4. The `reset_code` branch both verifies and updates in one request — that path is already proven by the code, so it does not need the cookie.

**Verify:** signed in normally (no recovery), POST `intent=reset_new` with a valid password pair → `recovery_failed`, password unchanged. Through the real reset flow → password changes.

### SEC-09 · Staff role: close the admin panel until permissions are implemented — Medium

**Evidence:** `canAccessPanel("staff", "admin")` is `true` (`app/lib/permissions.ts`), but `can()` is never called anywhere in `app/` and almost every admin RLS policy uses `is_admin()` (admin only). A staff user sees every admin page, most of which fail; the email-template "test" action (`app/routes/admin/email-templates.tsx` ~line 118) sends mail with the service-role client for any panel user. There are currently **0 staff accounts**.

**Change (simple, safe):**
1. `app/lib/permissions.ts` → `canAccessPanel`: `case "admin": return role === "admin";`. Update the doc comment: staff access is disabled until per-page permissions are wired.
2. `tests/permissions.test.ts`: update the staff expectation for the admin panel to `false`.
3. In `app/routes/admin/email-templates.tsx` and `app/routes/api/admin-import-rejects.ts` (the two admin routes that use the service client), after `requirePanelAccess(...)`, keep the returned viewer and `if (viewer.profile.role !== "admin") throw new Response("Forbidden", { status: 403 });` — defence in depth if step 1 is ever reverted.

**Verify:** `npm test` passes; a user whose `profiles.role = 'staff'` (create one in a rolled-back SQL check or a throw-away account) gets the 403 page on `/en/admin`.

### SEC-10 · Hide the design-system preview in production — Low

**Evidence:** `GET /ar/ui` → 200 in the production build (`app/routes/ui-preview.tsx`).

**Change:** at the top of the `loader` in `app/routes/ui-preview.tsx`: `if (process.env.NODE_ENV === "production") throw new Response("Not found", { status: 404 });`. Keep the existing `Disallow: /ar/ui` lines in robots.

**Verify:** `npm run build && npm start`, then `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ar/ui` → `404`.

### FUN-01 · Show "Continue with Google" only when enabled — Medium

**Evidence:** `GET https://suba.fakarli.com/auth/v1/settings` → `"google": false`; `app/routes/auth/login.tsx` ~line 207–212 always renders the Google form.

**Change**
1. `app/lib/env.server.ts`: add `export function isGoogleAuthEnabled(): boolean { return process.env.GOOGLE_AUTH_ENABLED === "true"; }` next to the other getters.
2. `.env.example`: add `GOOGLE_AUTH_ENABLED=false` with a comment "set true only after the Google provider is enabled in GoTrue".
3. `login.tsx` loader: return `googleEnabled: isGoogleAuthEnabled()`; render the divider + Google form only when true. Do the same in `register.tsx` if it has a Google button (grep `auth/google`).
4. `app/routes/auth/google.ts` action: if not enabled, redirect to `/${lang}/auth/login` without calling Supabase.

**Verify:** login page has no Google button with the default env; `curl -X POST localhost:3000/en/auth/google` → 302 to login.

---

## Phase 3 — Functional defects

### FUN-02 · Contact messages: constrain the table and add an admin inbox — Medium

**Evidence:** `contact_messages` is written by `app/routes/contact.tsx`, but `grep -rln contact_messages app` finds only that file — nobody can read the messages. `anon` also has direct `INSERT` (policy `with check (true)`), so the app's length checks can be bypassed via PostgREST.

**Part A — migration `supabase/migrations/20261105000002_contact_messages_admin.sql`:**
1. Read the table definition in `supabase/migrations/20261031000005_phase04_storefront.sql` (~line 126) to get the exact column names.
2. Add check constraints that mirror `contact.tsx` validation (use `not valid` then `validate constraint` so existing rows are checked but the migration does not fail on a bad old row — if validation fails, report the row count instead of deleting rows):
   - `char_length(name) between 3 and 80`
   - `char_length(subject) between 3 and 120`
   - `char_length(message) between 10 and 2000`
   - `char_length(email) <= 254`
3. Add `handled_at timestamptz` (nullable) if the table has no status column.
4. Grant and policies: `grant select, update (handled_at) on public.contact_messages to authenticated;` plus policies `contact_admin_read` (`for select to authenticated using (public.is_admin())`) and `contact_admin_update` (`for update to authenticated using (public.is_admin()) with check (public.is_admin())`).

**Part B — page `app/routes/admin/contact-messages.tsx`:**
1. Copy the structure of a simple existing list page, e.g. `app/routes/admin/logs.tsx` (loader with `requirePanelAccess(client, lang, "admin", request)`, a table, pagination via `range()`).
2. Loader: `select id, name, email, phone, subject, message, created_at, handled_at` ordered by `created_at desc`, 50 per page, filter `?status=open|handled`.
3. Action: intent `toggle_handled` with `id` → sets/clears `handled_at`; guard with `requirePanelAccess` in the action too.
4. Register the route in `app/routes.ts` under the admin block: `route("contact-messages", "routes/admin/contact-messages.tsx"),`.
5. Add a nav entry in `app/layouts/admin.tsx` (copy an existing entry's shape; pick an existing icon such as the mail/inbox one if present).
6. i18n keys in both files: `nav.contactMessages`, `adminContact.title`, `.empty`, `.open`, `.handled`, `.markHandled`, `.markOpen`, column headers.

**Verify:** submit the public contact form → the message appears in the new admin page → "mark handled" moves it to the handled filter. As anon, a direct insert with a 1-character message fails with a check-constraint error.

### FUN-03 · Payment confirmation edge cases — Medium

**Evidence:** `fn_confirm_payment` (live definition): (a) when `p_amount_piastres` is NULL the amount check is skipped; (b) a `succeeded` webhook for an order whose status is `cancelled` sets `payment_status = 'paid'` and leaves it cancelled with no refund flag.

**Change — migration `supabase/migrations/20261105000003_confirm_payment_guards.sql`:**
1. Get the current body: `select pg_get_functiondef('public.fn_confirm_payment'::regproc);` and copy it **verbatim** into the migration as `create or replace function …`.
2. Change the amount condition from `if p_amount_piastres is not null and p_amount_piastres <> v_order.total_piastres then` to `if p_amount_piastres is null or p_amount_piastres <> v_order.total_piastres then` (the stored `amount_piastres` in that branch becomes `coalesce(p_amount_piastres, 0)`).
3. Right after the `p_status not in (…)` check, add:
   ```sql
   if p_status = 'succeeded' and v_order.status = 'cancelled' then
     insert into public.payments (order_id, provider, provider_ref, amount_piastres, status, raw_payload, processed_at)
     values (v_order.id, 'kashier', v_ref, v_order.total_piastres, 'succeeded',
             coalesce(p_raw, '{}'::jsonb) || jsonb_build_object('needs_refund', true), now());
     insert into public.order_status_history (order_id, status, note)
     values (v_order.id, v_order.status, 'paid_after_cancel_needs_refund');
     return jsonb_build_object('ok', true, 'idempotent', false, 'reason', 'paid_after_cancel');
   end if;
   ```
   Check first that `payments.status` allows `'succeeded'` and `order_status_history.status` accepts the current status (look at the check constraints with `\d public.payments`); adapt only if the constraint differs, and report it.
4. Keep `security definer`, `set search_path to 'public'`, and re-apply the original grants (it is not granted to anon/authenticated — keep it that way; verify with `has_function_privilege` after applying).

Also in `app/features/checkout/kashier.server.ts` → `verifyKashierWebhook`: if the payload has no parseable amount, return `{ ok: false, reason: "missing_amount" }` instead of passing `null`. Read the function first; adapt to its return type.

**Verify:** in a rolled-back transaction as postgres, create nothing — call `select public.fn_confirm_payment('<an existing order number>', 'test-ref', 'succeeded', null, '{}'::jsonb);` → `reason = amount_mismatch`. (If no order exists, place a COD test order through the UI first and delete it after via admin.)

### FUN-04 · Notification bell: drop the dead Realtime channel, pause polling when hidden — Low

**Evidence:** `app/features/notifications/NotificationBell.tsx` ~line 49–58 subscribes with the browser Supabase client, which has no session because auth cookies are httpOnly; RLS hides every row from anon, so the callback never fires. The 20 s `setInterval` keeps polling even in background tabs.

**Change**
1. Remove the `createBrowserClientSafe()` / `.channel(...)` block, its `channel` variable and the cleanup lines; remove now-unused imports.
2. Replace the interval with: poll every 30 s **only when `document.visibilityState === "visible"`**, and call `refresh()` on the `visibilitychange` event when the tab becomes visible. Clean up the listener in the effect's return.
3. Remove the connect-src `wss:` entry comment about Realtime in `app/root.tsx` **only if** nothing else uses Realtime (`grep -rn "channel(" app` must be empty) — then drop the `connectSrc.push(sbOrigin.replace(/^https:/, "wss:"))` line too.

**Verify:** typecheck passes; open the account page, create a notification for that user via SQL (`insert into public.notifications …` as postgres) → the badge updates within 30 s; no websocket to `suba.fakarli.com` in the browser network tab.

---

## Phase 4 — SEO and performance

### SEO-01 · Sitemap and indexing of empty categories — Medium

**Evidence:** `/sitemap.xml` has 1,619 URLs, 1,609 of them categories (1.1 MB); there are currently 0 products, so every category page is empty, yet it renders `<meta name="robots" content="index, follow">`.

**Change**
1. `app/routes/sitemap[.xml].ts`: include a category only if at least one public product exists in its subtree. Collect the set of leaf ids that have products (paged `fetchAll` over `v_storefront_products` selecting `leaf_category_id`), then load categories with `id, path`, and keep a category when any product leaf's `path` contains the category id. (`categories.path` is the `/`-joined chain of ancestor ids, including itself — confirm by reading `fn_category_path` or a row.) Keep the existing paging via `app/lib/supabase/fetch-all.ts`.
2. `app/routes/category.tsx` (or the shared listing server code it uses — `server-listing.ts`): when the category subtree has 0 products, pass `noindex: true` to `publicMeta(...)` (the same option `order.tsx` uses).
3. Keep the category page itself working (it must still render with an empty state).

**Verify:** with 0 products, `curl -s localhost:3000/sitemap.xml | grep -c "/category/"` → `0`, and an empty category page has `content="noindex`. After a product is approved, its category chain (L1→L4) appears in the sitemap.

### SEO-02 · robots.txt gaps — Low

`app/routes/robots[.txt].ts`: add `Disallow` lines for both locales: `/cart`, `/checkout`, `/order/`, `/compare`, `/search` (search result pages are thin), plus `/api/`. Keep the existing lines and the `Sitemap:` line. **Verify:** `curl -s localhost:3000/robots.txt`.

### PERF-01 · Admin attributes page payload (~1.2 MB) — Low

**Evidence:** `app/routes/admin/catalog/attributes.tsx` loads all 1,339 attribute defs, all options and all 12,158 template links in one loader.

**Change (keep behaviour identical):**
1. Loader: keep loading the leaf list and the attribute dictionary (needed for pickers), but **do not** load `category_attributes` for every leaf. Load links only for the selected leaf (`?leaf=<id>` search param) — the page already has a selected-leaf state; move it to the URL with `useSearchParams` so the loader can read it.
2. Usage counts per leaf shown in `LeafPicker.tsx` come from the full link set — replace them with one aggregated query: `select category_id, count(*) from category_attributes group by category_id` via a new SQL view or RPC (`fn_admin_template_counts()` returning `(category_id uuid, n int)`, `security definer`, `is_admin()` guard, granted to authenticated). Put it in a new migration `(not needed — done)`.
3. Measure before/after: `curl -s -b <admin cookie> "localhost:3000/en/admin/catalog/attributes.data" | wc -c`.

**Verify:** payload < 400 KB; selecting a leaf, linking, unlinking and reordering attributes still works and persists after reload.

### PERF-02 · Per-process state — document only

The in-memory rate limiter (`app/lib/rate-limit.server.ts`) and the media LRU (`app/lib/media-cache.server.ts`) are per Node process. Add a short "Deployment constraints" section to `README.md`: run **one** Node instance, or move rate-limit state to a shared store (e.g. a `rate_limits` table with an upsert RPC) before scaling out. No code change now.

---

## Phase 5 — Cleanup and code quality

### CQ-01 · Fix lint warnings in `app/` and `tests/`

`npm run lint` reports 30 warnings. Fix all in `app/` and `tests/`:
- Unused imports: `app/routes/admin/reports.tsx` (`PackageIcon`), `app/routes/blog.$slug.tsx` (`redirect`, vars `html` ~l.149, `i18n` ~l.152), `app/routes/admin/orders.tsx` (`CheckIcon`), `app/routes/admin/events.tsx` (`AlertIcon`), `app/routes/account/addresses.tsx` (`PencilIcon`), `app/layouts/account.tsx` (`ShieldIcon`).
- `no-control-regex` in `app/lib/postgrest.ts:28` and `app/lib/auth/next.ts:14`: these regexes intentionally match control characters — add `// oxlint-disable-next-line no-control-regex` with a one-line reason above each.
- `tests/media-server-guard.test.ts:51` `no-thenable`: the mock intentionally imitates a thenable query builder — add a disable comment with the reason.
Script warnings (`scripts/*.mjs`) are covered by CQ-02.

**Verify:** `npm run lint` shows 0 warnings for `app/` and `tests/`.

### CQ-02 · Archive one-off scripts

Move every phase/evidence/screenshot script that is not referenced from `package.json` or the README into `scripts/archive/` (e.g. `phase*-screens.mjs`, `p4-*`, `p5-*`, `p8-*`, `hardening-*`, `evidence-*`, `closing-screenshots.mjs`, `shoot-ui.mjs`, `otp-screen-390.mjs`, `prove-f02-render.mjs`, `rezip-phase2.ps1`, `test-phase*.mjs`, `verify-phase*.mjs`, `measure-lcp-throttled.mjs`, `audit-phase3-perf.mjs`, `check-*.mjs`). **Keep in place:** `apply-migration.mjs`, `build-catalog-import.mjs`, `rls-audit.mjs`, `rls-test-suite.sql`, `scan-design.mjs`, `optimize-images.mjs`, `test-staff-isolation.mjs`. Before moving, `grep -rn "<script name>" package.json README.md docs` for each — keep anything referenced. Change `lint` in `package.json` to `oxlint app scripts tests --ignore-pattern "scripts/archive/**"`.

### FUN-05 · Remove the unused Phase-09 staging pipeline — Low (do last, separate commit)

The live catalog was imported directly (`supabase/seed/catalog-import.sql`); the staging path is dead.
1. Remove from `app/routes.ts`: the `data-import`, `data-import/templates` admin routes and `api/admin/import-rejects`.
2. Delete `app/routes/admin/data-import.tsx`, `app/routes/admin/data-import.templates.tsx`, `app/routes/api/admin-import-rejects.ts`, and any feature module only they import (check with grep before deleting each file).
3. Remove the admin nav entry for Data Import in `app/layouts/admin.tsx` and its now-unused i18n keys from **both** locale files.
4. Move `scripts/import-phase09.mjs` to `scripts/archive/`.
5. **Do not drop the `staging_*` tables or `fn_admin_publish_batch` in this task** — dropping data is an owner decision. List them in the final report.

**Verify:** `npm run verify` green; `/en/admin/data-import` → 404; the admin nav no longer shows it.

---

## Phase 6 — UI and accessibility

Evidence for this phase comes from an automated browser sweep (Chrome, 1366×900 and 390×844, Arabic and English, public pages plus account/admin/vendor panels signed in as the admin). There is **no horizontal overflow on any page** and no console errors besides expected 404s, so those need no work. Before starting, take "before" screenshots of each page you change (desktop and 390 px mobile) and compare after.

### UI-01 · Page titles for panel and auth pages — High

**Evidence:** `document.title` is empty on `/ar/auth/login`, `/en/auth/register`, `/ar/auth/forgot`, every `/ar/account/*`, every `/ar/admin/*`, `/ar/vendor/*`, and `/ar/product/<missing>`. Neither `app/root.tsx` nor any layout exports `meta`, and these routes don't either.

**Change**
1. In each of `app/layouts/auth.tsx`, `app/layouts/account.tsx`, `app/layouts/admin.tsx`, `app/layouts/vendor.tsx`, add a `meta` export that reads an optional title key from the deepest matched route's `handle`, with a panel fallback:
   ```ts
   export const meta: Route.MetaFunction = ({ params, matches }) => {
     const lang = params.lang === "en" ? "en" : "ar";
     const t = getI18n(lang).t;
     const key = [...matches].reverse()
       .map((m) => (m?.handle as { titleKey?: string } | undefined)?.titleKey)
       .find(Boolean);
     const page = key ? t(key) : t("<panel title key — e.g. the one the admin layout header already uses>");
     return [{ title: `${page} — ${t("app.name")}` }, { name: "robots", content: "noindex, nofollow" }];
   };
   ```
   Use the i18n key each layout already shows in its header for the fallback (read the layout). Import `getI18n` the same way `app/routes/order.tsx` does.
2. Add `export const handle = { titleKey: "<existing nav label key>" };` to each page under those layouts. Reuse the **nav label keys** already used in the sidebars (e.g. `nav.orders`, `nav.vendors`) — do not invent new strings when a nav key exists. For auth pages use their existing heading keys (`auth.login.title` etc. — confirm the names in `en.ts`).
3. Important: in React Router 7 a child route that exports its own `meta` **replaces** the parent's. Pages under these layouts that already export `meta` keep working; check with `grep -L "export const meta" app/routes/admin/*.tsx` that the rest get the layout title.
4. For the product/category/store 404 see UI-04.

**Verify:** sweep the pages again (or open several in the browser): every tab shows "<Page> — اتسوء/Etsawaa".

### UI-02 · Category pages always claim a filter is active — High

**Evidence:** `app/features/storefront/listing.ts:65` `isFiltered()` returns true when `state.category` is set, and `filterCount()` (~line 83) counts it. On a category page the category is fixed by the URL (`opts.fixedCategory`, line 33), so `app/components/catalog/Listing.tsx:67` always picks the "zero results **with filters**" state: "No results for these filters — you have 1 active now" + "Remove all filters".

**Change**
1. Give both functions an optional second parameter `fixedCategory?: string | null`; ignore `state.category` when it equals `fixedCategory`:
   ```ts
   export function isFiltered(state: FilterState, fixedCategory?: string | null): boolean {
     const category = state.category && state.category !== fixedCategory ? state.category : null;
     return Boolean(state.q || state.brand || state.attrs.length > 0 || state.priceMin != null ||
       state.priceMax != null || state.rating != null || state.inStock || category);
   }
   ```
   Same idea in `filterCount`.
2. In `Listing.tsx`, pass the page's fixed category to both calls. Find how `Listing` knows its fixed category (grep `fixedCategory` in `app/components/catalog` and `app/features/storefront`); if it is not a prop yet, add `fixedCategory?: string | null` to `Listing`'s props and pass it from `app/routes/category.tsx`.
3. Check `clearAll` in `Listing.tsx` does not strip the fixed category when it is used (it must keep the visitor on the same category).
4. Add cases to `tests/store-filters.test.ts`: fixed category only → not filtered, count 0; fixed category + colour → filtered, count 1.

**Verify:** `/en/category/casual` shows the plain empty state ("No products yet" + "Browse all products"), not "Remove all filters". `npm test` passes.

### UI-03 · Admin Attributes page: unusable list — High (do together with PERF-01)

**Evidence:** `/en/admin/catalog/attributes` is 30,260 px tall: `app/components/admin/catalog/LeafPicker.tsx` renders every one of the 1,391 product types as a card. The card title is always `leaf.name_ar` (line 67) with `name_en` underneath, also on the English UI. The badge "1391" next to the page title has no label.

**Change**
1. `LeafPicker.tsx`: take the current language (it is used inside the admin page; get it with `useTranslation().i18n.language` or a `lang` prop — follow what sibling components in `app/components/admin/catalog/` do). Title = name in the UI language, subtitle = the other language + parent name.
2. Show at most **60** cards; under the grid add a "Show more" button that adds 60 more. When the search box has text, show all matches (search already filters). Reset to 60 when the search text changes.
3. Add a placeholder to the search input (new key `adminAttributes.searchPlaceholder`: "Search product types (Arabic or English)" / "ابحث عن نوع المنتج (عربي أو إنجليزي)").
4. Label the count badge: render it as `t("adminAttributes.typeCount", { count })` → "1,391 product types" / "1,391 نوع منتج". Check existing key names in `en.ts` under the attributes page namespace first and follow them.
5. Group optional: not required.

**Verify:** the page is < 6,000 px tall at load; searching "laptop" finds "Laptops"; on `/en/…` titles are English.

### UI-04 · 404s lose the site shell — Medium

**Evidence:** `/ar/product/does-not-exist` renders only a "404" card on a blank page (no header, footer, search) with an empty title. The 404 comes from the product loader; the boundary that catches it is the **public layout's** `ErrorBoundary` (`app/layouts/public.tsx:111`), and a layout's boundary replaces the whole layout including header/footer.

**Change**
1. Export `export function ErrorBoundary() { return <RouteErrorBoundary />; }` (import from `~/components/layout/RouteErrorBoundary`) from every public **leaf** route that can throw: `app/routes/product.tsx`, `category.tsx`, `store.tsx`, `brand.tsx`, `static-page.tsx`, `blog.$slug.tsx`, `order.tsx`, `order-track.tsx`. A leaf boundary renders inside the parent layout's `<Outlet />`, so the header/footer stay.
2. Add to each of those routes' `meta` a not-found title when the loader data is missing: e.g. in `product.tsx` `meta`, `if (!data) return [{ title: \`${t("errors.notFound.title")} — ${t("app.name")}\` }, { name: "robots", content: "noindex" }];` — use the key `RouteErrorBoundary` already uses for its 404 heading.

**Verify:** `/ar/product/does-not-exist` shows the 404 card **between** the normal header and footer, status still 404, tab title "الصفحة غير موجودة — اتسوء".

### UI-05 · Facets with zero results — Medium

**Evidence:** on `/en/category/casual` (0 products) the sidebar lists 23 colours and 39 sizes, all "0", including EU 35–47 shoe sizes and Single/Double/Queen/King bed sizes.

**Change**
1. Find the facet component (`grep -rln "facet" app/components/catalog app/features/storefront`).
2. Hide each option whose count is 0 **unless it is currently selected** (a selected option must stay visible so it can be unticked).
3. Hide a whole facet group when it has no visible options.
4. When the listing total is 0 and nothing is filtered, hide the attribute facet groups entirely (keep price/rating/in-stock hidden too — nothing to filter).

**Verify:** the casual category shows no colour/size lists while it has no products. After one product with colour Black + size M is approved in a category, only Black and M appear there.

### UI-06 · Category tile placeholders — Medium

**Evidence:** home "All categories" and category sub-tiles render the first letter when there is no thumbnail: Arabic names starting with "ال" all show "ا"; English product types mostly "M" ("Men's …").

**Change:** find the placeholder (grep `thumb_path` / `charAt(0)` / `slice(0, 1)` in `app/components/catalog` and `app/routes/home.tsx`). Replace the letter with a neutral category icon from the project's existing icon set (look in `app/components/ui` or wherever `StoreIcon`/`GridIcon` are exported; the nav uses a grid icon for "Categories" — reuse it). Keep the same tile size and colours.

**Verify:** home and `/en/category/casual` tiles show the icon, no letters.

### UI-07 · Category page header order and duplicate h1 — Medium

**Evidence:** `app/routes/category.tsx:94` renders an `<h1>` with the category name, and `app/components/catalog/Listing.tsx:76` renders another `<h1>` with the same title. The sub-category tiles come before the breadcrumb.

**Change**
1. Add a prop to `Listing` like `headingLevel?: "h1" | "h2"` (default `"h1"`); `category.tsx` passes `"h2"`. Render the tag accordingly.
2. In `category.tsx`, move the breadcrumb (currently rendered by the listing or below the tiles — read the file) to the top of the page, above the header card and tiles.

**Verify:** category pages have exactly one `<h1>` (`document.querySelectorAll("h1").length === 1`) and the breadcrumb is the first thing under the site header.

### UI-08 · Missing h1 — Medium

Make sure exactly one `<h1>` exists on: home (`app/routes/home.tsx` — add a visually hidden `<h1 className="sr-only">{t("app.name")} — {t("<home tagline key used in meta>")}</h1>` at the top), `/vendors` (`app/routes/vendors.tsx:73` — the only h1 is inside the "featured" block; render an h1 with `t("nav.vendors")` always and turn the featured heading into `h2`), cart and compare **empty states** (render the existing page title `h1` in the empty branch too), `app/routes/admin/users.tsx` and `app/routes/admin/logs.tsx` (use the shared `PageHeader` component like other admin pages; it renders the h1).

**Verify:** each page has exactly one `<h1>`.

### UI-09 · `/vendors` empty state — Medium

**Evidence:** with no stores at all, `/ar/vendors` says "No matching stores — try changing the filters", though no filter is selected. **Change:** in `app/routes/vendors.tsx`, when `loaderData.stores.length === 0` (no stores at all) show a separate empty state "No stores yet" + CTA to `/${lang}/sell` ("Open your store"); keep the current message only when filters are set and the filtered list is empty. New keys `store.vendor.noneYet.title/body/cta` in both locales.

### UI-10 · Empty cart at checkout — Medium

**Evidence:** `/ar/checkout` as a guest with 0 items shows the account gate (`app/components/checkout/GuestGate.tsx`) with "cart items: 0". **Change:** in `app/routes/checkout.tsx`, check the cart count **before** the guest gate: if 0 (guest or signed in), redirect to `/${lang}/cart` (the cart page already has an empty state). Read how the loader gets the guest cart count (the gate shows it) and reuse that value.

**Verify:** `/ar/checkout` with an empty cart → 302 to `/ar/cart`.

### UI-11 · Admin forced into vendor onboarding — Medium

**Evidence:** signed in as admin, `/ar/vendor` and `/ar/vendor/products` redirect to `/ar/vendor/onboarding` (`app/layouts/vendor.tsx` ~line 26–32 redirects every user without a submitted store).

**Change:** in the vendor layout loader, before the onboarding redirect: `if (viewer.profile.role === "admin") throw redirect(\`/${lang}/admin/vendors\`);`. Do the same at the top of the loader in `app/routes/vendor/onboarding.tsx` (read how it gets the viewer; it has no direct guard — it delegates to a feature server module; put the check where the viewer is resolved). Admins manage vendors from the admin panel.

**Verify:** as admin, `/ar/vendor` → `/ar/admin/vendors`. A normal vendor without a store still lands on onboarding.

### UI-12 · Fake "System operational" badge — Medium

**Evidence:** `app/routes/admin/dashboard.tsx:210–214` always renders the green pulsing "System operational" badge. **Change:** derive it from the loader: set `systemOk = true` only if every KPI query in the dashboard loader returned without `error` (read the loader; collect the `error` fields it already receives). Render the green badge when `systemOk`, otherwise an amber badge with a new key `adminDash.systemDegraded` ("Some data failed to load" / "تعذر تحميل بعض البيانات"). If the loader does not expose errors, remove the badge.

### UI-13 · Kashier badge without card payments — Medium

**Evidence:** the footer shows "الدفع عند الاستلام" and "Kashier" badges; card payment is not configured. **Change:** find the badge (`grep -rn "Kashier" app/components app/layouts app/lib/i18n`). Have the public layout loader return `cardPayments: isKashierConfigured()` (the helper exists in `app/features/checkout/kashier.server.ts:16` — check its exported name) and render the Kashier badge only when true.

### UI-14 · Broken live event text — OWNER confirms, implementer edits

**Evidence:** the active event "الجمعة البيضاء / Black Friday" (id `fdd4dde6-4400-4bc6-aa80-8646e19e53e0`, 2026-11-01 → 2026-11-30) has `desc_ar = "خصومات نوفمبر على-category من الإدارة"` and no vendors take part, yet the home page shows "Shop the offer".
- **Owner decides:** fix the text (suggested `خصومات نوفمبر على كل الأقسام`) or deactivate the event. Do it in Admin → Events.
- **Code (implementer):** on the home page, show the active-event card only when the event has at least one participating vendor/product. Find where `home.tsx` reads `v_storefront_active_event` and add the check using `v_active_event_vendors` (count > 0).

### UI-15 · One numeral system — Low

**Evidence:** `app/lib/money.ts:10` formats Arabic money with `ar-EG` → Arabic-Indic digits ("٠٫٠٠ ج.م."), while counts everywhere render Latin digits. **Change:** use `"ar-EG-u-nu-latn"` for the Arabic locale in `money.ts` (and any other `Intl.NumberFormat`/`toLocaleString("ar…")` call — grep `ar-EG`). Update `tests/money.test.ts` expectations accordingly. **Owner may prefer Arabic-Indic everywhere instead — if so, ask before changing; the goal is one system.**

### UI-16 · Translate the role in panel headers — Low

`app/layouts/vendor.tsx:98` (and the admin layout header, same pattern) prints `loaderData.role` raw. Add keys `roles.admin`, `roles.staff`, `roles.vendor`, `roles.customer` (check first whether such keys already exist, e.g. used in `admin/users.tsx`) and render `t(\`roles.${role}\`)`.

### UI-17 · Mobile tap targets — Low

Minimum 24×24 px (WCAG 2.2 AA "Target size"):
- Hero carousel dots (home): keep the visual dot, but make the button `min-h-6 min-w-6` with the dot as an inner span.
- Footer links: add `inline-block py-1` (≈27 px) on mobile.
- Admin category tree row actions (move up/down, edit, delete; currently 22×22): `size-8 sm:size-6`.
- Register terms checkbox and admin zones checkboxes: wrap so the whole label is clickable (it likely already is via `<label>`) and set the box `size-5`.
- Auth card "Back to home" link: `py-1`.

### UI-18 · Accessible names — Low

- `app/routes/admin/catalog/categories.tsx` (or its tree component): the expand/collapse buttons (`aria-expanded`, `size-6`) need `aria-label={t(expanded ? "common.collapse" : "common.expand")}` (create keys if missing).
- Search inputs in `admin/orders.tsx` and `admin/customers.tsx`: add `aria-label` equal to the placeholder text key.
- Banners image-path input (`admin/banners.tsx`, placeholder `u/…`): connect it to a visible label with `id`/`htmlFor`, or add `aria-label`.

### UI-19 · Auth page duplicates — Low

Auth pages render inside the public shell, which already has the logo and language switch. In `app/layouts/auth.tsx` (or the auth card component) remove the extra logo above the card and the language switcher below it; keep "Back to home". Change the login identifier placeholder to `you@example.com / 01012345678` (find the key used by `login.tsx`).

### UI-20 · Distinct admin nav icons — Low

`app/layouts/admin.tsx` nav: give Orders, Returns & warranty, Vendor shipping requests and Withdrawal requests different icons; same for Coupons, Ads, Events, Banners, Brands, Tags. Use only icons that already exist in the project's icon module (list them first); if none fits, leave that item unchanged rather than adding a library.

---

## Owner review items (no code)

- **REV-01:** review the 70 Arabic labels added in Phase 09 (`NEW_SPECS` in `scripts/build-catalog-import.mjs`); edit any in Admin → Catalog → Attributes.
- Category thumbnails: product-type tiles show letter placeholders until images are uploaded.
- Decide whether to drop the `staging_*` tables (FUN-05 step 5).
- Variant axes: Storage, RAM and Capacity are specs, not variant axes — decide if they should become variant dictionaries like Color/Size.
- UI-14: fix or deactivate the "Black Friday" event text.
- UI-15: Latin or Arabic-Indic digits across the Arabic UI (pick one).
- UI-21: brand spelling — "اتسوء" (current `app.name` in `ar.ts`) or "إتسوء" (logo). Once decided, update `app.name` and any hard-coded copies (`grep -rn "اتسوء\|إتسوء" app`).

---

## Final acceptance checklist (run after all phases)

1. `npm run verify` → typecheck clean, 0 lint warnings in `app/`/`tests/`, all unit tests pass, build succeeds.
2. RLS suite on the VPS → 20/20 pass.
3. SQL spot checks as `anon` (rolled back): view write denied, `fn_resolve_email_from_phone` denied, `fn_media_usage` denied, and the "anon-executable SECURITY DEFINER" query lists only the allowed functions from SEC-05.
4. Browser smoke test (ar and en): home, category, search, product, cart, COD checkout, order page, account pages, vendor product wizard (create → variants → submit), admin approve, admin attributes link/unlink, admin contact inbox, forgot-password via phone (masked email), login via phone.
5. UI re-check at 1366 px and 390 px, ar and en: every page has a non-empty title and exactly one `<h1>`; category pages show the plain empty state; 404s keep the header/footer; no horizontal scroll anywhere (it is clean today — keep it so).
6. `curl` checks: `/ar/ui` 404, `robots.txt` has the new disallows, sitemap has no empty categories, auth endpoints return 429 after their limits.
7. Final report lists: every task done (with commit hash), every task skipped and why, every OWNER item still open.
