import { data, type ActionFunctionArgs } from "react-router";
import { getSupabaseAdminClient } from "~/lib/supabase/admin";
import { clientKey, rateLimit } from "~/lib/rate-limit.server";
import { CONTACT_LIMITS, contactFileKind } from "~/features/contact/limits";

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif",
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/3gpp": "3gp", "video/x-matroska": "mkv",
};

/**
 * POST /api/contact-upload — signed upload slots for contact-form attachments.
 *
 * Visitors (signed in or not) attach photos and videos to the contact forms.
 * Files go straight from the browser to the private `contact` bucket through
 * one-time signed upload URLs, so a 200 MB set of videos never passes through
 * the app server (or Cloudflare's per-request body cap). This route only
 * checks the declared type/size against the limits and hands out slots; the
 * form action re-checks the stored objects' real sizes before saving.
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") return data({ ok: false, reason: "method" }, { status: 405 });
  const ip = clientKey(request) ?? "anon";
  if (!rateLimit(`contact-upload:${ip}`, 12, 10 * 60_000)) return data({ ok: false, reason: "rate_limited" }, { status: 429 });
  const admin = getSupabaseAdminClient();
  if (!admin) return data({ ok: false, reason: "not_configured" }, { status: 503 });

  const body = (await request.json().catch(() => null)) as { files?: Array<{ name?: unknown; size?: unknown; type?: unknown }> } | null;
  const files = Array.isArray(body?.files) ? body!.files : [];
  if (files.length === 0 || files.length > CONTACT_LIMITS.maxFiles) return data({ ok: false, reason: "count" }, { status: 400 });

  let images = 0, videos = 0;
  const month = new Date().toISOString().slice(0, 7);
  const slots: Array<{ path: string; url: string; token: string }> = [];
  for (const f of files) {
    const type = String(f.type ?? "");
    const size = Number(f.size ?? 0);
    const kind = contactFileKind(type);
    if (!kind || !Number.isFinite(size) || size <= 0) return data({ ok: false, reason: "type" }, { status: 400 });
    if (kind === "image") {
      if (size > CONTACT_LIMITS.imageMax) return data({ ok: false, reason: "image_too_big" }, { status: 400 });
      images += size;
    } else {
      if (size > CONTACT_LIMITS.videoMax) return data({ ok: false, reason: "video_too_big" }, { status: 400 });
      videos += size;
    }
    if (images > CONTACT_LIMITS.imagesTotal) return data({ ok: false, reason: "images_total" }, { status: 400 });
    if (videos > CONTACT_LIMITS.videosTotal) return data({ ok: false, reason: "videos_total" }, { status: 400 });
    // extension from the checked MIME type, never from the visitor's file name
    const ext = EXT_BY_TYPE[type] ?? (kind === "image" ? "img" : "vid");
    const path = `inbox/${month}/${crypto.randomUUID()}.${ext}`;
    const { data: slot, error } = await admin.storage.from("contact").createSignedUploadUrl(path);
    if (error || !slot) return data({ ok: false, reason: "storage" }, { status: 502 });
    slots.push({ path, url: slot.signedUrl, token: slot.token });
  }
  return { ok: true as const, slots };
}
