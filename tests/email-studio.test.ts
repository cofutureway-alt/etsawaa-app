import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { EMAIL_CATALOG, EMAIL_DEFINITIONS, emailSampleVariables } from "../app/lib/email/catalog";
import { validateContent, renderEmailContent, safeEmailUrl, localizeEmailUrl, compileEmailTemplate } from "../app/lib/email/content";
import { tagErrors } from "../app/lib/email/validate";
import { htmlToText } from "../app/lib/email/sender";
import { authEmailMessages, authEmailLocale, verifyAuthEmailHook, type AuthEmailPayload } from "../app/lib/email/auth-hook.server";
import { cookieLocale, localeFromRedirect, sameOriginRequest } from "../app/lib/locale-preference.server";
import { encryptAuthEmail, decryptAuthEmail } from "../app/lib/email/auth-queue.server";

test("all 62 current messages and 7 Auth templates render cleanly in both languages", () => {
  assert.equal(EMAIL_CATALOG.length, 69);
  assert.equal(new Set(EMAIL_CATALOG.map((t) => t.key)).size, 69);
  for (const template of EMAIL_CATALOG) {
    assert.deepEqual(validateContent(template.content, template.variables).ok, true, template.key);
    for (const locale of ["ar", "en"] as const) {
      const rendered = renderEmailContent(template.content[locale], locale, emailSampleVariables(locale, template.key));
      assert.deepEqual(tagErrors(rendered.html), [], `${template.key}:${locale}`);
      assert.ok(!rendered.html.includes("{{"), `${template.key}:${locale}: unresolved variables`);
      assert.ok(rendered.html.includes(`lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}"`));
      assert.ok(rendered.html.includes("https://etsawaa.com/logo-transparent.png"));
    }
  }
});
test("hidden inbox text does not leak into the plain-text alternative", () => {
  assert.equal(htmlToText('<div data-email-preheader style="display:none">Hidden preview</div><p>Visible message</p>'), "Visible message");
});
test("structured fields cannot inject HTML; unresolved variables and unsafe links block sending", () => {
  const original = EMAIL_DEFINITIONS.get("welcome")!;
  const content = { ...original.content.ar, body: '<img src=x onerror="alert(1)"> {{name}}' };
  const rendered = renderEmailContent(content, "ar", { ...emailSampleVariables("ar", "welcome"), name: "<script>bad</script>" });
  assert.ok(rendered.html.includes("&lt;img")); assert.ok(!rendered.html.includes("<script>bad"));
  assert.throws(() => renderEmailContent(content, "ar", {}), /missing_variables/);
  assert.throws(() => renderEmailContent({ ...content, buttonUrl: "javascript:alert(1)" }, "ar", emailSampleVariables("ar", "welcome")), /invalid_button_url/);
  assert.equal(validateContent({ ...original.content, en: { ...original.content.en, body: "{{unknown}}" } }, original.variables).ok, false);
  assert.equal(validateContent({ ...original.content, en: { ...original.content.en, buttonUrl: "" } }, original.variables).ok, false);
  assert.ok(compileEmailTemplate(original.content.ar, "ar", original.variables).includes('href="{{site_url}}"'));
});
test("links stay HTTPS and own-site links follow the recipient language", () => {
  for (const url of ["javascript:alert(1)", "http://etsawaa.com", "//etsawaa.com", "https://user:pass@example.com"]) assert.equal(safeEmailUrl(url), false);
  assert.equal(localizeEmailUrl("https://etsawaa.com/ar/order/42?x=1", "en", "https://etsawaa.com"), "https://etsawaa.com/en/order/42?x=1");
  assert.equal(localizeEmailUrl("https://payments.example/ar/pay", "en", "https://etsawaa.com"), "https://payments.example/ar/pay");
});
const payload: AuthEmailPayload = { user: { id: "00000000-0000-4000-8000-000000000001", email: "old@example.com", new_email: "new@example.com", user_metadata: { locale: "ar" } }, email_data: { email_action_type: "signup", token: "111111", token_hash: "current-hash", redirect_to: "https://etsawaa.com/en/auth/verify" } };
test("Auth uses current trusted action language, then saved preference, then signup language", () => {
  assert.equal(authEmailLocale(payload, "https://etsawaa.com", "ar"), "en");
  const fallback = { ...payload, email_data: { ...payload.email_data, redirect_to: "https://evil.example/en/auth/verify" } };
  assert.equal(authEmailLocale(fallback, "https://etsawaa.com", "ar"), "ar");
  assert.equal(authEmailLocale({ ...fallback, user: { ...payload.user, user_metadata: { locale: "en" } } }, "https://etsawaa.com"), "en");
});
test("secure email change sends each address its correct token/hash pair", () => {
  const secure = { ...payload, email_data: { ...payload.email_data, email_action_type: "email_change" as const, token_new: "222222", token_hash: "new-address-hash", token_hash_new: "old-address-hash" } };
  const messages = authEmailMessages(secure, "en", "https://etsawaa.com");
  assert.equal(messages[0]!.to, "old@example.com"); assert.equal(messages[0]!.variables.code, "111111"); assert.ok(messages[0]!.variables.confirmation_url!.includes("old-address-hash"));
  assert.equal(messages[1]!.to, "new@example.com"); assert.equal(messages[1]!.variables.code, "222222"); assert.ok(messages[1]!.variables.confirmation_url!.includes("new-address-hash"));
  const single = authEmailMessages({ ...secure, email_data: { ...secure.email_data, token_new: "", token_hash_new: "" } }, "ar", "https://etsawaa.com");
  assert.equal(single.length, 1); assert.equal(single[0]!.to, "new@example.com");
  assert.throws(() => authEmailMessages({ ...secure, user: { ...payload.user, new_email: "" } }, "ar", "https://etsawaa.com"));
});
test("Auth webhook rejects tampering and expired signatures; rotated secrets work", () => {
  const key = randomBytes(32), raw = JSON.stringify(payload), timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", key).update(`evt_1.${timestamp}.${raw}`).digest("base64");
  const headers = new Headers({ "webhook-id": "evt_1", "webhook-timestamp": timestamp, "webhook-signature": `v1,${signature}` });
  const secret = `v1,whsec_${key.toString("base64")}`;
  assert.equal(verifyAuthEmailHook(raw, headers, secret), true);
  assert.equal(verifyAuthEmailHook(raw + " ", headers, secret), false);
  assert.equal(verifyAuthEmailHook(raw, headers, secret, Date.now() + 301_000), false);
  assert.equal(verifyAuthEmailHook(raw, headers, `v1,whsec_${randomBytes(32).toString("base64")}|${secret}`), true);
});
test("preference reads accept only supported locales and writes reject cross-site origins", () => {
  assert.equal(cookieLocale(new Request("https://etsawaa.com", { headers: { cookie: "x=1; etsawaa_locale=en" } })), "en");
  assert.equal(cookieLocale(new Request("https://etsawaa.com", { headers: { cookie: "etsawaa_locale=fr" } })), null);
  assert.equal(localeFromRedirect("https://evil.example/en", "https://etsawaa.com"), null);
  assert.equal(sameOriginRequest(new Request("https://etsawaa.com/api/preferences/locale", { headers: { origin: "https://evil.example" } })), false);
  assert.equal(sameOriginRequest(new Request("https://etsawaa.com/api/preferences/locale", { headers: { origin: "https://etsawaa.com" } })), true);
});
test("queued Auth codes are encrypted and authenticated, and cannot be read with another key", () => {
  const key = randomBytes(32).toString("base64");
  const email = { to: "qa@example.com", key: "auth:signup", locale: "en" as const, variables: { code: "864219", confirmation_url: "https://etsawaa.com/en/auth/verify?token_hash=secret" } };
  const encrypted = encryptAuthEmail(email, key);
  assert.ok(!encrypted.includes(email.variables.code)); assert.ok(!encrypted.includes("token_hash"));
  assert.deepEqual(decryptAuthEmail(encrypted, key), email);
  assert.throws(() => decryptAuthEmail(encrypted, randomBytes(32).toString("base64")));
  assert.throws(() => encryptAuthEmail(email, "invalid"));
  assert.notEqual(encryptAuthEmail(email, key), encrypted, "each job has a unique nonce");
});
