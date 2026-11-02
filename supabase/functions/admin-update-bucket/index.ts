// Edge function: admin-update-bucket (M-06)
// Validates the caller is a signed-in admin (via anon key + JWT), then applies
// the media limits to the storage buckets with the service role. Runs server-
// side only; the service key never reaches the browser.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": Deno.env.get("SITE_URL") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405, headers: CORS });

  const authHeader = req.headers.get("Authorization") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const url = Deno.env.get("SUPABASE_URL") ?? "";

  // who is calling?
  const authClient = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await authClient.auth.getUser();
  if (userErr || !userData?.user) {
    return new Response(JSON.stringify({ error: "not_signed_in" }), { status: 401, headers: { ...CORS, "Content-Type": "application/json" } });
  }

  const svc = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
    auth: { persistSession: false },
  });
  const { data: profile } = await svc.from("profiles").select("role").eq("id", userData.user.id).single();
  if (profile?.role !== "admin") {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...CORS, "Content-Type": "application/json" } });
  }

  const body = await req.json().catch(() => ({}));

  if (body.action === "probe") {
    const { data: buckets, error } = await svc.storage.listBuckets();
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
    return new Response(JSON.stringify({ ok: true, buckets: (buckets ?? []).map((b) => ({ id: b.id, limit: b.file_size_limit, mimes: b.allowed_mime_types })) }), { headers: { ...CORS, "Content-Type": "application/json" } });
  }

  if (body.action === "apply" && body.media) {
    const m = body.media;
    const mimes: string[] = Array.isArray(m.allowed_mimes) ? m.allowed_mimes : [];
    const kinds: string[] = [];
    if (m.allow_images) kinds.push("image/");
    if (m.allow_video) kinds.push("video/");
    if (m.allow_pdf) kinds.push("application/pdf");
    const allowed = mimes.filter((mime: string) => kinds.some((p) => mime.startsWith(p)));
    const maxBytes = Math.round(
      Math.max(
        m.allow_images ? m.max_image_mb : 0,
        m.allow_video ? m.max_video_mb : 0,
        m.allow_pdf ? m.max_pdf_mb : 0,
      ) * 1024 * 1024,
    );
    const results: Record<string, unknown> = {};
    const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    for (const bucket of ["media", "documents"]) {
      // This storage build exposes bucket updates on PUT (supabase-js PATCH no-ops).
      const res = await fetch(`${url}/storage/v1/bucket/${bucket}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${svcKey}`, apikey: svcKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          public: bucket === "media",
          file_size_limit: maxBytes > 0 ? maxBytes : null,
          allowed_mime_types: allowed.length > 0 ? allowed : null,
        }),
      });
      if (!res.ok) {
        results[bucket] = `http_${res.status}: ${(await res.text()).slice(0, 120)}`;
        continue;
      }
      // verify by reading back
      const check = await fetch(`${url}/storage/v1/bucket/${bucket}`, { headers: { Authorization: `Bearer ${svcKey}`, apikey: svcKey } });
      const row = await check.json();
      const limitOk = (row.file_size_limit ?? null) === (maxBytes > 0 ? maxBytes : null);
      const mimesOk = JSON.stringify(row.allowed_mime_types ?? null) === JSON.stringify(allowed.length > 0 ? allowed : null);
      results[bucket] = limitOk && mimesOk ? "ok" : `mismatch(limit=${row.file_size_limit}, mimes=${JSON.stringify(row.allowed_mime_types)})`;
    }
    return new Response(JSON.stringify({ ok: true, results }), { headers: { ...CORS, "Content-Type": "application/json" } });
  }

  return new Response(JSON.stringify({ error: "invalid_action" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
});
