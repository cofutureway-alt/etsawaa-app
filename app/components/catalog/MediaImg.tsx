/**
 * Public-bucket image with explicit dimensions (no CLS — S-15), lazy by
 * default, token-driven placeholder. Render transforms are not enabled on
 * this project (403 — phase-03 finding), so we ship the plain public URL.
 */
/**
 * Same-origin media proxy (see app/routes/api/media.ts): one localhost hop
 * for the LCP image instead of a cold third-origin fetch, with immutable
 * caching. path is a public-bucket object path.
 */
export function mediaUrl(path: string): string {
  return `/api/media?path=${encodeURIComponent(path)}`;
}

export function MediaImg({
  path,
  alt,
  width = 400,
  height = 400,
  eager = false,
  priority = false,
  className = "",
  sizes,
}: {
  path: string;
  alt: string;
  width?: number;
  height?: number;
  eager?: boolean;
  /** L-12 — mark the likely LCP image: high fetch priority + no lazy */
  priority?: boolean;
  className?: string;
  sizes?: string;
}) {
  const loadEager = eager || priority;
  return (
    <img
      src={mediaUrl(path)}
      alt={alt}
      width={width}
      height={height}
      sizes={sizes}
      loading={loadEager ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      draggable={false}
      className={`bg-surface-tint object-cover ${className}`}
    />
  );
}
