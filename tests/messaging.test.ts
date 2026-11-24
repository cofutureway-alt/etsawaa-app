import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { renderText, smsSize, unknownVariables, maskNumber } from "../app/lib/messaging/text";
import { looksLikePhone, localDigits, formatLocal } from "../app/lib/phone-countries";
import { audienceOf, effectiveRoute, eventsFor, MESSAGE_EVENTS, MESSAGE_EVENT_MAP } from "../app/lib/messaging/catalog";
import { verifyRasvioSignature } from "../app/lib/messaging/webhook";
import { EMAIL_DEFINITIONS } from "../app/lib/email/catalog";

test("renderText fills variables and drops unknown ones", () => {
  assert.equal(renderText("رمزك {{code}} {{x}}", { code: "123456" }), "رمزك 123456");
  assert.equal(renderText("a\n\n\n\nb", {}), "a\n\nb");
});

test("smsSize counts Arabic at 70 and Latin at 160 per part", () => {
  assert.deepEqual(smsSize("a".repeat(160)), { chars: 160, parts: 1, perPart: 160, unicode: false });
  assert.equal(smsSize("a".repeat(161)).parts, 2);
  assert.equal(smsSize("ب".repeat(70)).parts, 1);
  assert.equal(smsSize("ب".repeat(71)).parts, 2);
  assert.equal(smsSize("").parts, 0);
});

test("every default code text fits one SMS part", () => {
  for (const e of MESSAGE_EVENTS.filter((x) => x.audience === "account")) {
    for (const t of [e.text.ar, e.text.en]) assert.equal(smsSize(renderText(t, { code: "123456" })).parts, 1, `${e.key}: ${t}`);
  }
});

test("unknownVariables lists only variables the event lacks", () => {
  assert.deepEqual(unknownVariables("{{code}} {{name}} {{code}}", ["code"]), ["name"]);
  assert.deepEqual(unknownVariables("plain", ["code"]), []);
});

test("maskNumber hides the middle digits", () => {
  assert.equal(maskNumber("+201012345678"), "+20 101 ••• 5678");
  assert.equal(maskNumber("bad"), "bad");
});

test("smart field: digits or + become a phone, letters or @ stay text", () => {
  assert.equal(looksLikePhone("0"), true);
  assert.equal(looksLikePhone("+20"), true);
  assert.equal(looksLikePhone("٠١٠"), true);
  assert.equal(looksLikePhone("010 1234"), true);
  assert.equal(looksLikePhone("a"), false);
  assert.equal(looksLikePhone("01a"), false);
  assert.equal(looksLikePhone("1@x.com"), false);
  assert.equal(looksLikePhone(""), false);
});

test("phone digits are grouped as typed and saved numbers show locally", () => {
  assert.equal(formatLocal(localDigits("01012345678")), "010 1234 5678");
  assert.equal(formatLocal(localDigits("0101")), "010 1");
  assert.equal(formatLocal(localDigits("+201012345678")), "010 1234 5678");
  assert.equal(formatLocal(localDigits("00201012345678")), "010 1234 5678");
  assert.equal(formatLocal(localDigits("٠١٠١٢٣٤٥٦٧٨")), "010 1234 5678");
  assert.equal(localDigits("010123456789999"), "01012345678");
});

test("every event's default text only uses its own variables", () => {
  for (const e of MESSAGE_EVENTS) assert.deepEqual(unknownVariables(`${e.text.ar}\n${e.text.en}`, e.variables), [], e.key);
});

test("every notification event with an email has its template in the email catalog", () => {
  for (const e of MESSAGE_EVENTS) if (e.emailTemplate) assert.ok(EMAIL_DEFINITIONS.has(e.emailTemplate), e.emailTemplate);
});

test("staff tab lists team alerts that name a permission", () => {
  const staff = eventsFor("staff");
  assert.ok(staff.length > 0);
  assert.ok(staff.every((e) => e.audience === "admin" && e.staffPermission));
  assert.ok(staff.some((e) => e.key === "product.pending"));
});

test("route defaults: staff starts off, order confirmation on every channel, email follows the template switch", () => {
  const pending = MESSAGE_EVENT_MAP.get("product.pending");
  assert.equal(effectiveRoute(pending, "staff", undefined, true).enabled, false);
  assert.equal(effectiveRoute(pending, "admin", undefined, false).email, false);
  assert.equal(effectiveRoute(pending, "admin", undefined, true).email, true);
  const conf = effectiveRoute(MESSAGE_EVENT_MAP.get("order_confirmation"), "customer", undefined, undefined);
  assert.deepEqual([conf.email, conf.sms, conf.whatsapp], [true, true, true]);
  const saved = { event_key: "x", audience: "customer" as const, enabled: true, email: false, sms: true, whatsapp: false, wa_sender_id: null };
  assert.equal(effectiveRoute(pending, "customer", saved, true), saved);
});

test("audienceOf: staff copies, catalog audience, then the recipient's role", () => {
  assert.equal(audienceOf("product.pending", "admin", true), "staff");
  assert.equal(audienceOf("product.approved", "staff", false), "vendor");
  assert.equal(audienceOf("unknown.type", "customer", false), "customer");
  assert.equal(audienceOf("unknown.type", "admin", false), "admin");
});

test("Rasvio webhook signature: right secret, fresh, untouched body", () => {
  const secret = "whsec_test_123456";
  const ts = String(Math.floor(Date.now() / 1000));
  const body = '{"type":"sms.delivered"}';
  const sig = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  assert.equal(verifyRasvioSignature(body, ts, sig, secret), true);
  assert.equal(verifyRasvioSignature(body + " ", ts, sig, secret), false);
  assert.equal(verifyRasvioSignature(body, ts, sig, "other"), false);
  assert.equal(verifyRasvioSignature(body, String(Number(ts) - 600), createHmac("sha256", secret).update(`${Number(ts) - 600}.${body}`).digest("hex"), secret), false);
  assert.equal(verifyRasvioSignature(body, null, sig, secret), false);
});
