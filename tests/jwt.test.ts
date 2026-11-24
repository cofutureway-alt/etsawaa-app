import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.SUPABASE_JWT_SECRET = "test-secret-for-unit-tests-only-0123456789";
const { verifyAccessToken } = await import("../app/lib/auth/jwt.server.ts");

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
function sign(payload: Record<string, unknown>, opts: { alg?: string; secret?: string } = {}) {
  const head = b64({ alg: opts.alg ?? "HS256", typ: "JWT" });
  const body = b64(payload);
  const sig = crypto.createHmac("sha256", opts.secret ?? process.env.SUPABASE_JWT_SECRET!).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}
const now = () => Math.floor(Date.now() / 1000);
const good = { sub: "11111111-1111-1111-1111-111111111111", email: "a@b.c", role: "authenticated", aud: "authenticated", exp: now() + 600 };

test("a valid HS256 access token is accepted with its claims", () => {
  const c = verifyAccessToken(sign(good));
  assert.equal(c?.sub, good.sub);
  assert.equal(c?.email, "a@b.c");
});

test("tampered payload, wrong secret, other algorithm, expired, wrong audience/role → null", () => {
  const t = sign(good);
  const [h, , s] = t.split(".");
  assert.equal(verifyAccessToken(`${h}.${b64({ ...good, sub: "evil" })}.${s}`), null);
  assert.equal(verifyAccessToken(sign(good, { secret: "another-secret" })), null);
  assert.equal(verifyAccessToken(sign(good, { alg: "none" })), null);
  assert.equal(verifyAccessToken(sign({ ...good, exp: now() - 1 })), null);
  assert.equal(verifyAccessToken(sign({ ...good, aud: "other" })), null);
  assert.equal(verifyAccessToken(sign({ ...good, role: "anon" })), null);
  assert.equal(verifyAccessToken("not.a.jwt"), null);
  assert.equal(verifyAccessToken(""), null);
});
