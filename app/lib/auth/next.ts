/**
 * Post-login redirect target. `next` comes from the URL, so it is attacker
 * controlled: a bare `startsWith("/")` check lets `//evil.com` through
 * (protocol-relative → off-site). Accept only a same-origin absolute path.
 *
 * Pure — covered by tests/next.test.ts.
 */
export function safeNext(next: unknown, fallback: string): string {
  if (typeof next !== "string" || next.length === 0) return fallback;
  // Must start with exactly one slash: "/path" ok, "//host" and "/\host" not.
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//") || next.startsWith("/\\")) return fallback;
  // Reject control chars and anything the URL parser would treat as a scheme.
  if (/[\u0000-\u001f\\]/.test(next)) return fallback;
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(next)) return fallback;
  return next;
}
