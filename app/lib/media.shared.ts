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

/**
 * Hard size cap of the private `documents` bucket (storage.buckets
 * file_size_limit, migration 20261103000012). Settings that allow more are
 * clamped to this in the UI, because Storage refuses larger objects anyway.
 */
export const DOCUMENTS_BUCKET_MAX_MB = 10;

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

/**
 * Raster formats the server re-encodes to WebP on upload (media-pipeline):
 * accepted whenever images are allowed, whatever the allowed_mimes list says,
 * because what gets stored is always WebP.
 */
export const CONVERTED_IMAGE_MIMES = ["image/jpeg", "image/png", "image/gif", "image/avif", "image/tiff", "image/bmp"];

/**
 * Video formats the `media` bucket accepts. Like CONVERTED_IMAGE_MIMES they
 * are allowed whenever video is on, whatever the allowed_mimes list says —
 * toggling "video" is enough.
 */
export const VIDEO_MIMES = ["video/mp4", "video/webm", "video/quicktime"];

const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
  avif: "image/avif", heic: "image/heic", heif: "image/heif", tif: "image/tiff", tiff: "image/tiff", bmp: "image/bmp",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
};

/** Browsers (Windows especially) send HEIC/AVIF with an empty or generic type — infer it from the extension. */
export function normalizeMime(type: string, name?: string): string {
  if (type && type !== "application/octet-stream") return type === "image/jpg" ? "image/jpeg" : type;
  const ext = (name ?? "").split(".").pop()?.toLowerCase() ?? "";
  return EXT_MIME[ext] ?? type;
}

/** Pre-upload guard — returns an i18n error-code, or null when allowed. */
export function validateUpload(file: { type: string; size: number; name?: string }, s: MediaSettings): string | null {
  const type = normalizeMime(file.type, file.name);
  const kind = detectKind(type);
  if (kind === "image" && !s.allow_images) return "media.errors.imagesOff";
  if (kind === "video" && !s.allow_video) return "media.errors.videoOff";
  if (kind === "pdf" && !s.allow_pdf) return "media.errors.pdfOff";
  if (!s.allowed_mimes.includes(type) && !CONVERTED_IMAGE_MIMES.includes(type)
      && !(kind === "video" && VIDEO_MIMES.includes(type))) return "media.errors.mime";
  if (file.size > maxBytesFor(kind, s)) return "media.errors.tooBig";
  return null;
}

/** Image dimension guard. max_dimensions_px was stored and editable but never
 *  enforced; this reads the bitmap before upload. Non-images pass through. */
export async function validateImageDimensions(file: File, maxPx: number): Promise<string | null> {
  if (!file.type.startsWith("image/")) return null;
  // converted formats are downscaled on the server (longest side 2560 px), so a
  // big phone photo is fine — only stored-as-is images keep the pixel limit
  if (CONVERTED_IMAGE_MIMES.includes(normalizeMime(file.type, file.name))) return null;
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    bitmap.close();
    // the key carries the numbers so the message can show them (see mediaErrorText)
    return width > maxPx || height > maxPx ? `media.errors.tooLargeDims?w=${width}&h=${height}&max=${maxPx}` : null;
  } catch {
    // Undecodable image — let the mime/size guards and the server decide.
    return null;
  }
}

export function publicMediaUrl(supabaseUrl: string, path: string): string {
  return `${supabaseUrl}/storage/v1/object/public/media/${path}`;
}


/** Error keys may carry interpolation values ("key?w=1&h=2"); split for t(). */
export function mediaErrorText(key: string): [string, Record<string, string>] {
  const [base = key, query = ""] = key.split("?");
  return [base, Object.fromEntries(new URLSearchParams(query))];
}
