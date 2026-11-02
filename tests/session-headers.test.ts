/**
 * Static guard for the session-cookie bug this phase fixed: a loader/action
 * that mints cookies via @supabase/ssr MUST forward `headers` on its
 * redirect/data response, or the refresh token rotates and is lost (random
 * sign-outs).
 *
 * The test scans auth routes — the ones that call getUser/verifyOtp/
 * exchangeCodeForSession — and fails if a destructure drops `headers`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AUTH_DIR = join(ROOT, "app/routes/auth");
const NL = String.fromCharCode(10);

function files(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(p);
  }
  return out;
}

function sessionMinting(): string[] {
  return files(AUTH_DIR).filter((f) =>
    /verifyOtp|exchangeCodeForSession|signInWithPassword|signInWithOAuth/.test(readFileSync(f, "utf8")),
  );
}

test("auth routes that mint sessions destructure headers", () => {
  const offenders: string[] = [];
  for (const file of sessionMinting()) {
    for (const line of readFileSync(file, "utf8").split(NL)) {
      if (!line.includes("createSupabaseServerClient(")) continue;
      const destructure = line.match(/\{([^}]*)\}\s*=\s*createSupabaseServerClient/);
      if (destructure && !(destructure[1] ?? "").includes("headers")) {
        offenders.push(relative(ROOT, file) + ": " + line.trim());
      }
    }
  }
  assert.deepEqual(offenders, [], "these session-minting routes drop Set-Cookie headers:" + NL + offenders.join(NL));
});

test("auth redirects forward headers", () => {
  const offenders: string[] = [];
  for (const file of sessionMinting()) {
    const src = readFileSync(file, "utf8");
    let i = src.indexOf("redirect(");
    while (i !== -1) {
      // Walk to the matching close paren so template `${...}` nested parens
      // don't truncate the call.
      let depth = 0;
      let j = i + "redirect".length;
      for (; j < src.length; j += 1) {
        if (src[j] === "(") depth += 1;
        else if (src[j] === ")") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      const text = src.slice(i, j + 1);
      const isSessionTarget = /\/auth\/(complete|account|callback)/.test(text);
      if (isSessionTarget && !text.includes("headers")) {
        offenders.push(relative(ROOT, file) + ": " + (text.split(NL)[0] ?? "").trim());
      }
      i = src.indexOf("redirect(", j);
    }
  }
  assert.deepEqual(offenders, [], "auth redirects missing { headers }:" + NL + offenders.join(NL));
});
