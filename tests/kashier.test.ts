import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { kashierOrderRef, orderNumberFromRef, verifyKashierWebhook, webhookSignature, webhookSignaturePayload } from "../app/features/checkout/kashier.server.ts";
import { parseKashierSettings } from "../app/features/checkout/kashier.shared.ts";

// the worked example from developers.kashier.io/docs/webhooks (key "11111")
const DOC_DATA = {
  amount: 1,
  channel: "online | e-commerce",
  currency: "EGP",
  kashierOrderId: "9ad06b17-755b-4e21-9774-aff3e2726ac9",
  merchantOrderId: "1653481557813",
  method: "card",
  orderReference: "TEST-ORD-38855",
  status: "SUCCESS",
  transactionId: "TX-249893963",
  transactionResponseCode: "00",
  signatureKeys: ["transactionResponseCode", "amount", "channel", "currency", "kashierOrderId", "merchantOrderId", "method", "orderReference", "status", "transactionId"],
};

test("webhook signature payload matches Kashier's documented string", () => {
  assert.equal(
    webhookSignaturePayload(DOC_DATA),
    "amount=1&channel=online%20%7C%20e-commerce&currency=EGP&kashierOrderId=9ad06b17-755b-4e21-9774-aff3e2726ac9&merchantOrderId=1653481557813&method=card&orderReference=TEST-ORD-38855&status=SUCCESS&transactionId=TX-249893963&transactionResponseCode=00",
  );
  assert.equal(webhookSignature("11111", DOC_DATA), "9610477b2255b2a8ef84fd89adfaa5f1305ff9c20324205851890f1ea03109f4");
});

test("webhook verification tells live from test by the key that signed it", () => {
  process.env.KASHIER_MERCHANT_ID = "MID-1-1";
  process.env.KASHIER_LIVE_API_KEY = "live-key";
  process.env.KASHIER_LIVE_SECRET_KEY = "s\$1";
  process.env.KASHIER_TEST_API_KEY = "test-key";
  process.env.KASHIER_TEST_SECRET_KEY = "s\$2";
  process.env.SUPABASE_URL ??= "http://x"; // skip the .env fallback loader
  const data = { ...DOC_DATA, merchantOrderId: "ETS-26-001_abc", amount: 125.5 };
  const body = JSON.stringify({ event: "pay", data });
  const sign = (k: string) => createHmac("sha256", k).update(webhookSignaturePayload(data)).digest("hex");

  const test1 = verifyKashierWebhook(body, sign("test-key"));
  assert.ok(test1.ok && test1.mode === "test" && test1.orderNumber === "ETS-26-001" && test1.amountPiastres === 12550 && test1.status === "succeeded");
  const live = verifyKashierWebhook(body, sign("live-key").toUpperCase());
  assert.ok(live.ok && live.mode === "live");
  const forged = verifyKashierWebhook(body, sign("other"));
  assert.deepEqual(forged, { ok: false, reason: "bad_signature" });
  assert.deepEqual(verifyKashierWebhook(body, null), { ok: false, reason: "bad_signature" });
});

test("order references are unique per attempt and map back to the order", () => {
  const a = kashierOrderRef("PKG-26-0007");
  assert.match(a, /^PKG-26-0007_[a-z0-9]+$/);
  assert.equal(orderNumberFromRef(a), "PKG-26-0007");
  assert.equal(orderNumberFromRef("ETS-26-001"), "ETS-26-001");
});

test("payment settings parse safely", () => {
  assert.deepEqual(parseKashierSettings(null), { enabled: true, testScope: "off", methods: [] });
  assert.deepEqual(parseKashierSettings({ kashier_enabled: false, kashier_test_mode: "admins", kashier_methods: ["wallet", "bogus"] }),
    { enabled: false, testScope: "admins", methods: ["wallet"] });
  assert.deepEqual(parseKashierSettings({ kashier_test_mode: "x", kashier_methods: "card" }).methods, ["card"]);
});
