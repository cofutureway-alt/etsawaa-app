/** Contact-form attachment limits (owner rule): images 7 MB each / 50 MB total, videos 50 MB each / 200 MB total. */
export const CONTACT_LIMITS = {
  imageMax: 7 * 1000 * 1000,
  imagesTotal: 50 * 1000 * 1000,
  videoMax: 50 * 1000 * 1000,
  videosTotal: 200 * 1000 * 1000,
  maxFiles: 20,
} as const;

export const CONTACT_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
export const CONTACT_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm", "video/3gpp", "video/x-matroska"];

export function contactFileKind(type: string): "image" | "video" | null {
  if (CONTACT_IMAGE_TYPES.includes(type)) return "image";
  if (CONTACT_VIDEO_TYPES.includes(type)) return "video";
  return null;
}

export interface ContactAttachment { path: string; name: string; size: number; type: string }

export const CUSTOMER_TOPICS = ["order", "return", "payment", "account", "product", "other"] as const;
export const VENDOR_TOPICS = ["selling", "payments", "shipping", "products", "account", "other"] as const;
