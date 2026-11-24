/**
 * MediaImage — public media <img> shared across admin/vendor pages and the
 * media library grid.
 *
 * Extracted from media-ui.tsx (barrel re-exports it; import paths unchanged).
 */
import { publicMediaUrl } from "~/lib/media.shared";

/* ------------------------------------------------------------------ MediaImage */
interface MediaImageProps {
  path: string;
  alt: string;
  width?: number;
  height?: number;
  eager?: boolean;
  className?: string;
  supabaseUrl: string;
}

/** M-09: public media image with CDN srcset, explicit dims, lazy, no CLS. */
export function MediaImage({ path, alt, width, height, eager = false, className = "", supabaseUrl }: MediaImageProps) {
  return (
    <img
      src={publicMediaUrl(supabaseUrl, path)}
      alt={alt}
      width={width ?? 400}
      height={height ?? 300}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      draggable={false}
      className={`bg-surface-tint object-cover ${className}`}
    />
  );
}
