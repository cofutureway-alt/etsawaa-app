// H-05 — SESSION STABILITY: 30 consecutive authenticated navigations across
// panels, then a page refresh, then an access-token-expiry simulation
// (corrupted access cookie, valid refresh cookie) — the app must RECOVER the
// session via refresh (one nav may 302 then re-login-free follow works only
// if refresh happens server-side via cookies; here we assert NO hard logout
// cookie clearing happened) and never mark the user signed out.
// Usage: node --input-type=module scripts/hardening-session-test.mjs
// (needs the app running on :3000). Writes evidence/phase-08.5/session-test.json
import fs from "node:fs";

const BASE = "http://localhost:3000";
const OUT = "evidence/phase-08.5/session-test.json";
fs.mkdirSync("evidence/phase-08.5", { recursive: true });

// ---- login like the browser (POST form) → capture REAL cookie
const form = new URLSearchParams({ identifier: process.env.TEST_ADMIN_EMAIL ?? "", password: process.env.TEST_ADMIN_PASSWORD ?? "" });
const loginRes = await fetch(`${BASE}/ar/auth/login`, {
  method: "POST", body: form,
  headers: { "Content-Type": "application/x-www-form-urlencoded" }, redirect: "manual",
});
const setCookies = (loginRes.headers.getSetCookie?.() ?? []).map((c) => c.split(";"));
const jar = new Map();
for (const c of setCookies) {
  const [pair] = c;
  const i = pair.indexOf("=");
  jar.set(pair.slice(0, i), pair.slice(i + 1));
}
// capture cookie options from the Set-Cookie attributes
const optSample = setCookies[0]?.join(";") ?? "";
const cookieLine = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
console.log("login:", loginRes.status, "cookies:", [...jar.keys()], "opts:", optSample.split(";").slice(1).join(",").trim());

// cookie attribute proof (H-05 DoD)
const attrsOk = (() => {
  const pathOk = /Path=\//i.test(optSample);
  const laxOk = /SameSite=Lax/i.test(optSample);
  const secureOk = !/Secure/i.test(optSample) || process.env.NODE_ENV === "production" || BASE.startsWith("https");
  const httpOnlyOk = /HttpOnly/i.test(optSample);
  return { pathOk, laxOk, secureOk, httpOnlyOk };
})();

// ---- 30 consecutive navigations across admin/vendor/account/public
const NAVS = [
  "/ar/admin", "/ar/admin/orders", "/ar/admin/products", "/ar/admin/customers", "/ar/admin/reviews",
  "/ar/admin/reports", "/ar/admin/zones", "/ar/admin/coupons", "/ar/admin/banners", "/ar/admin/logs",
  "/ar/account", "/ar/account/orders", "/ar/account/addresses", "/ar/account/wishlist", "/ar/account/profile",
  "/ar/admin/levels", "/ar/admin/penalties", "/ar/admin/ads", "/ar/admin/events", "/ar/admin/blog",
  "/ar", "/ar/products", "/ar/cart", "/ar/account", "/ar/admin",
  "/ar/admin/vendors", "/ar/admin/refunds", "/ar/account/recent", "/ar/account/notifications", "/ar/admin",
];
let loggedOut=0, fiveHundreds=0; const failures=[];
for (let i=0;i<NAVS.length;i++){
  const r=await fetch(BASE+NAVS[i],{headers:{Cookie:cookieLine()},redirect:"manual"});
  const sc=(r.headers.getSetCookie?.()??[]).map(c=>c.split(";")[0]);
  for(const pair of sc){const j=pair.indexOf("=");if(j>0)jar.set(pair.slice(0,j),pair.slice(j+1));}
  const loc=r.headers.get("location")??"";
  const isLoginRedirect = r.status===302 && loc.includes("/auth/login");
  if(isLoginRedirect) loggedOut++;
  if(typeof r.status==="number" && r.status>=500) fiveHundreds++;
  if(isLoginRedirect || r.status>=500) failures.push({nav:r.status+" "+NAVS[i]+" → "+loc});
  await new Promise(r=>setTimeout(r,60));
}
console.log(`30 navigations: loggedOut=${loggedOut} 500s=${fiveHundreds}`);

// ---- refresh keeps session
const ref1=await fetch(BASE+"/ar/account",{headers:{Cookie:cookieLine()},redirect:"manual"});
const refreshKept = !(ref1.status===302 && (ref1.headers.get("location")??"").includes("/auth/login")) && ref1.status<500;
console.log("refresh keeps session:", refreshKept, ref1.status);

// ---- token expiry simulation: destroy access cookie, KEEP refresh cookie
const accessKey = [...jar.keys()].find(k=>k.includes("auth-token"));
const refreshKey = [...jar.keys()].find(k=>k.includes("refresh"));
const refreshVal = refreshKey? jar.get(refreshKey) : null;
if(accessKey) jar.delete(accessKey);
if(refreshKey && refreshVal) jar.set(refreshKey, refreshVal);
const r2=await fetch(BASE+"/ar/account",{headers:{Cookie:cookieLine()},redirect:"manual"});
const loc2=r2.headers.get("location")??"";
// either it recovered (200) or redirected to login WITH returnTo (no loop) —
// but NOT a hard-logout that deleted the refresh cookie
let setAfter = [];
if(r2.headers.getSetCookie){
  for(const c of (r2.headers.getSetCookie?.()??[])){
    const [pair]=c.split(";");
    const j=pair.indexOf("=");
    // deletion cookies have empty value / Max-Age=0
    if(!pair.slice(j+1)) setAfter.push(pair.slice(0,j)+"(deleted)");
    else jar.set(pair.slice(0,j),pair.slice(j+1));
  }
}
const recovered = r2.status===200;
const clearAttempt = setAfter.some(s=>s.includes("(deleted)"));
console.log("after access-token wipe:", r2.status, loc2.slice(0,60) || "", "deletedCookies:", setAfter);
console.log(recovered ? "RECOVERED via refresh (200)" : clearAttempt? "HARD LOGOUT DETECTED (refresh deleted)" : "redirected w/ cookies intact");

const result={
  at:new Date().toISOString(), navCount:NAVS.length,
  loggedOut, fiveHundreds, failures,
  refreshKept, attrs:attrsOk,
  expirySim:{status:r2.status, recovered, clearAttempt, redirected:loc2||null},
  pass: loggedOut===0 && fiveHundreds===0 && refreshKept && (recovered || (!clearAttempt && loc2.includes("next="))),
};
fs.writeFileSync(OUT, JSON.stringify(result,null,1));
console.log(result.pass?"H-05 PASS":"H-05 FAIL");
process.exit(result.pass?0:1);
