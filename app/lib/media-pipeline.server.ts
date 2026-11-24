import net from "node:net";

/**
 * Upload pipeline shared by every server-side upload path (media library,
 * /api/upload, Google avatar import, contact attachments):
 *
 *   1. scanForViruses — the bytes are streamed to ClamAV (clamd INSTREAM on the
 *      `etsawaa-clamav` container). FAIL-CLOSED: if the scanner is down the
 *      upload is refused ("scan_unavailable"), never stored unscanned.
 *   2. toWebp — raster images (jpeg/png/gif/avif/tiff/bmp) are re-encoded to
 *      WebP (EXIF orientation applied, metadata stripped, longest side capped).
 *      Re-encoding also neutralises image/script polyglots. Animated GIFs stay
 *      animated. WebP input is kept as is; SVG/PDF/video are never touched.
 *
 * Env: CLAMAV_HOST (default etsawaa-clamav), CLAMAV_PORT (3310),
 *      MEDIA_SCAN=off disables scanning (local dev without clamd only).
 */

export class UploadRejected extends Error {
  constructor(public reason: "infected" | "scan_unavailable" | "bad_image", public detail?: string) {
    super(reason);
  }
}

const CHUNK = 64 * 1024;
const SCAN_TIMEOUT_MS = 120_000;

/** Stream bytes to clamd; resolves when clean, throws UploadRejected otherwise. */
export async function scanForViruses(bytes: Uint8Array): Promise<void> {
  if (process.env.MEDIA_SCAN === "off") return;
  const host = process.env.CLAMAV_HOST || "etsawaa-clamav";
  const port = Number(process.env.CLAMAV_PORT || 3310);
  const reply = await new Promise<string>((resolve, reject) => {
    const sock = net.createConnection({ host, port });
    let out = "";
    const timer = setTimeout(() => { sock.destroy(); reject(new Error("timeout")); }, SCAN_TIMEOUT_MS);
    sock.on("error", (e) => { clearTimeout(timer); reject(e); });
    sock.on("data", (d) => { out += d.toString("utf8"); });
    sock.on("end", () => { clearTimeout(timer); resolve(out); });
    sock.on("connect", () => {
      sock.write("zINSTREAM\0");
      for (let i = 0; i < bytes.length; i += CHUNK) {
        const part = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
        const len = Buffer.alloc(4);
        len.writeUInt32BE(part.length, 0);
        sock.write(len);
        sock.write(part);
      }
      sock.write(Buffer.alloc(4)); // zero-length chunk = end of stream
    });
  }).catch((e: unknown) => {
    console.error("[media-scan] clamd unreachable:", e instanceof Error ? e.message : e);
    throw new UploadRejected("scan_unavailable");
  });
  const text = reply.replace(/\0/g, "").trim();
  if (/\bOK$/.test(text)) return;
  if (/FOUND$/.test(text)) {
    const name = text.replace(/^stream:\s*/, "").replace(/\s*FOUND$/, "");
    console.warn("[media-scan] infected upload refused:", name);
    throw new UploadRejected("infected", name);
  }
  // "INSTREAM size limit exceeded" and other clamd errors: refuse, never store unscanned
  console.error("[media-scan] clamd error:", text);
  throw new UploadRejected("scan_unavailable", text);
}

const CONVERTIBLE = new Set([
  "image/jpeg", "image/jpg", "image/pjpeg", "image/png", "image/gif", "image/avif",
  "image/tiff", "image/heic", "image/heif", "image/bmp",
]);
// HEIC/HEIF decoding needs libheif's HEVC codec, which sharp's prebuilt binary
// may lack: such a photo is refused as bad_image rather than stored unconverted
const MAX_SIDE = 2560;

export interface ProcessedFile {
  bytes: Uint8Array;
  mime: string;
  /** extension for the object path (without dot) */
  ext: string;
  width: number | null;
  height: number | null;
}

/** Re-encode a raster image to WebP; other types pass through unchanged. */
export async function toWebp(bytes: Uint8Array, mime: string, fallbackExt: string): Promise<ProcessedFile> {
  if (!CONVERTIBLE.has(mime) && mime !== "image/webp") return { bytes, mime, ext: fallbackExt, width: null, height: null };
  const sharp = (await import("sharp")).default;
  try {
    if (mime === "image/webp") {
      const meta = await sharp(bytes).metadata();
      return { bytes, mime, ext: "webp", width: meta.width ?? null, height: meta.height ?? null };
    }
    const animated = mime === "image/gif";
    const { data, info } = await sharp(bytes, { animated, limitInputPixels: 80_000_000 })
      .rotate()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    return { bytes: new Uint8Array(data), mime: "image/webp", ext: "webp", width: info.width, height: animated ? (info.pageHeight ?? info.height) : info.height };
  } catch (e) {
    console.warn("[media-webp] not a decodable image:", e instanceof Error ? e.message : e);
    throw new UploadRejected("bad_image");
  }
}

/** Scan, then convert. Use for every new upload. */
export async function processUpload(bytes: Uint8Array, mime: string, fileName: string): Promise<ProcessedFile> {
  await scanForViruses(bytes);
  const dot = fileName.lastIndexOf(".");
  const ext = (dot >= 0 ? fileName.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : "") || "bin";
  return toWebp(bytes, mime, ext);
}

/** u/{uid}/{uuid}.{ext} — same shape as buildObjectPath, with the processed extension. */
export function processedObjectPath(uid: string, ext: string): string {
  return `u/${uid}/${crypto.randomUUID()}.${ext}`;
}
