import { getSupabaseAdminClient } from "~/lib/supabase/admin";

/**
 * Media retention worker (owner rule 2026-11-07): files nothing uses are
 * deleted once they are 30+ days old — library uploads never attached,
 * replaced avatars/logos, abandoned contact attachments, failed uploads.
 *
 * "Unused" comes from fn_media_cleanup_candidates (migration 017), which
 * scans every text/json column for the path, so a file referenced anywhere —
 * product galleries, rich-text HTML, settings, archived products, documents,
 * contact messages — is kept. Runs at most once per ~day per database (the
 * last run is read back from media_cleanup_runs), in batches, and logs what
 * it removed. Env: MEDIA_CLEANUP=off disables it; MEDIA_CLEANUP_DAYS (min 30).
 */

const CHECK_EVERY_MS = 6 * 60 * 60_000;
const MIN_GAP_MS = 20 * 60 * 60_000;
const BATCH = 200;
const MAX_BATCHES = 10;
let started = false;

export function ensureMediaCleanupWorker(): void {
  if (started || typeof setInterval === "undefined") return;
  if (process.env.MEDIA_CLEANUP === "off") return;
  started = true;
  const run = () => { void runMediaCleanup().catch((e) => console.error("[media-cleanup]", e instanceof Error ? e.message : e)); };
  const timer = setInterval(run, CHECK_EVERY_MS);
  (timer as { unref?: () => void }).unref?.();
  setTimeout(run, 10 * 60_000); // first pass 10 min after boot, off the startup path
}

export async function runMediaCleanup(): Promise<{ deleted: number; freed: number } | null> {
  const admin = getSupabaseAdminClient();
  if (!admin) return null;
  const days = Math.max(30, Number(process.env.MEDIA_CLEANUP_DAYS ?? 30) || 30);

  const { data: last } = await admin.from("media_cleanup_runs").select("ran_at").order("ran_at", { ascending: false }).limit(1).maybeSingle();
  if (last && Date.now() - new Date(last.ran_at as string).getTime() < MIN_GAP_MS) return null;

  let candidates = 0, deleted = 0, freed = 0, failed = 0;
  const sample: string[] = [];
  for (let i = 0; i < MAX_BATCHES; i++) {
    const { data: rows, error } = await admin.rpc("fn_media_cleanup_candidates", { p_days: days, p_limit: BATCH });
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as Array<{ bucket_id: string; name: string; size_bytes: number; media_file_id: string | null }>;
    if (list.length === 0) break;
    candidates += list.length;
    const byBucket = new Map<string, typeof list>();
    for (const r of list) byBucket.set(r.bucket_id, [...(byBucket.get(r.bucket_id) ?? []), r]);
    let progressed = false;
    for (const [bucket, group] of byBucket) {
      const { data: removed, error: rmErr } = await admin.storage.from(bucket).remove(group.map((g) => g.name));
      if (rmErr) { failed += group.length; console.error("[media-cleanup] remove", bucket, rmErr.message); continue; }
      const gone = new Set(((removed ?? []) as Array<{ name: string }>).map((o) => o.name));
      const done = group.filter((g) => gone.has(g.name));
      failed += group.length - done.length;
      if (done.length === 0) continue;
      progressed = true;
      deleted += done.length;
      freed += done.reduce((s, g) => s + Number(g.size_bytes || 0), 0);
      for (const g of done) if (sample.length < 50) sample.push(`${bucket}/${g.name}`);
      const ids = done.map((g) => g.media_file_id).filter((x): x is string => Boolean(x));
      if (ids.length) await admin.from("media_files").delete().in("id", ids);
    }
    if (!progressed || list.length < BATCH) break;
  }

  await admin.from("media_cleanup_runs").insert({ days, candidates, deleted, freed_bytes: freed, failed, detail: { sample } });
  if (deleted || failed) console.log(`[media-cleanup] deleted ${deleted} unused file(s), ${(freed / 1e6).toFixed(1)} MB freed, ${failed} failed`);
  return { deleted, freed };
}
