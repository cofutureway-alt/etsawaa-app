import { z } from "zod";

/**
 * Media settings (`settings.media`) — shape shared by the admin form,
 * the upload guard (client pre-check) and the edge function.
 */
export const MEDIA_SETTINGS_SCHEMA = z.object({
  allow_images: z.boolean(),
  allow_video: z.boolean(),
  allow_pdf: z.boolean(),
  allowed_mimes: z.array(z.string()),
  max_image_mb: z.number().min(0.1).max(50),
  max_video_mb: z.number().min(0.1).max(50),
  max_pdf_mb: z.number().min(0.1).max(50),
  max_dimensions_px: z.number().int().min(100).max(8000),
});

export type MediaSettings = z.infer<typeof MEDIA_SETTINGS_SCHEMA>;

export const DEFAULT_MEDIA_SETTINGS: MediaSettings = {
  allow_images: true,
  allow_video: false,
  allow_pdf: false,
  allowed_mimes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  max_image_mb: 5,
  max_video_mb: 50,
  max_pdf_mb: 10,
  max_dimensions_px: 4000,
};

export function parseMediaSettings(raw: unknown): MediaSettings {
  const parsed = MEDIA_SETTINGS_SCHEMA.safeParse(raw);
  return parsed.success ? parsed.data : { ...DEFAULT_MEDIA_SETTINGS };
}

export type MediaKind = "image" | "video" | "pdf" | "file";

/** Objects live at u/{uid}/{uuid}.{ext} — the uid segment is the RLS boundary. */
export function buildObjectPath(uid: string, fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const ext = dot >= 0 ? fileName.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : "bin";
  return `u/${uid}/${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;
}

export function detectKind(mime: string): MediaKind {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "pdf";
  return "file";
}

export function maxBytesFor(kind: MediaKind, s: MediaSettings): number {
  const mb = kind === "image" ? s.max_image_mb : kind === "video" ? s.max_video_mb : kind === "pdf" ? s.max_pdf_mb : 5;
  return Math.round(mb * 1024 * 1024);
}

/** Pre-upload guard — returns an i18n error-code, or null when allowed. */
export function validateUpload(file: { type: string; size: number }, s: MediaSettings): string | null {
  const kind = detectKind(file.type);
  if (kind === "image" && !s.allow_images) return "media.errors.imagesOff";
  if (kind === "video" && !s.allow_video) return "media.errors.videoOff";
  if (kind === "pdf" && !s.allow_pdf) return "media.errors.pdfOff";
  if (!s.allowed_mimes.includes(file.type)) return "media.errors.mime";
  if (file.size > maxBytesFor(kind, s)) return "media.errors.tooBig";
  return null;
}

export function publicMediaUrl(supabaseUrl: string, path: string): string {
  return `${supabaseUrl}/storage/v1/object/public/media/${path}`;
}

/** Render-transform srcset for public images (smaller variants on the CDN). */
export function mediaSrcSet(supabaseUrl: string, path: string): string {
  return [480, 800, 1280]
    .map((w) => `${supabaseUrl}/storage/v1/render/image/public/media/${path}?width=${w} ${w}w`)
    .join(", ");
}
