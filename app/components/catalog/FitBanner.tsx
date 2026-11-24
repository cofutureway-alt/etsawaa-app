/**
 * Banner sizes (owner request): every banner of a placement renders in the
 * same box, whatever the uploaded image size. The image is fitted inside
 * (object-contain, nothing cropped or spilling out) and any leftover space is
 * filled with a soft blurred copy of the same image, so a wrong-size upload
 * still looks intentional. Uploading at the recommended size fills it exactly.
 */
export const BANNER_SIZES = {
  /** home hero carousel */
  hero: { w: 1920, h: 800 },
  /** banners between home sections and at the bottom */
  section: { w: 1920, h: 640 },
  /** paid banner on top of a category page */
  category: { w: 1920, h: 480 },
  /** ad carousel on the product page, under "Shipping details" */
  product: { w: 1200, h: 800 },
} as const;

export type BannerKind = keyof typeof BANNER_SIZES;

export function FitBanner({ src, alt, kind, srcSet, sizes, eager, className = "" }: {
  src: string;
  alt: string;
  kind: BannerKind;
  srcSet?: string;
  sizes?: string;
  eager?: boolean;
  className?: string;
}) {
  const { w, h } = BANNER_SIZES[kind];
  return (
    <div className={`relative w-full overflow-hidden bg-surface-tint ${className}`} style={{ aspectRatio: `${w} / ${h}` }}>
      <img aria-hidden="true" src={src} alt="" decoding="async" loading={eager ? "eager" : "lazy"}
        className="pointer-events-none absolute inset-0 size-full scale-110 object-cover opacity-70 blur-2xl select-none" draggable={false} />
      <img src={src} srcSet={srcSet} sizes={sizes} alt={alt} width={w} height={h} decoding="async"
        loading={eager ? "eager" : "lazy"} fetchPriority={eager ? "high" : "auto"} draggable={false}
        className="relative block size-full object-contain select-none" />
    </div>
  );
}
