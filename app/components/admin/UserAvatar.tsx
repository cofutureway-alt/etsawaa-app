import { MediaImg } from "~/components/catalog/MediaImg";

/**
 * Round avatar for admin lists: the profile's media image when set, otherwise
 * the first letter of the name on a tinted disc.
 */
export function UserAvatar({ name, path, size = "md" }: {
  name: string;
  path: string | null | undefined;
  size?: "sm" | "md" | "lg";
}) {
  const box = { sm: "size-7 text-xs", md: "size-9 text-sm", lg: "size-16 text-xl" }[size];
  const px = { sm: 28, md: 36, lg: 64 }[size];
  if (path) {
    return <MediaImg path={path} alt="" width={px} height={px} className={`${box} shrink-0 rounded-full border border-border object-cover`} />;
  }
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span aria-hidden="true" className={`${box} flex shrink-0 items-center justify-center rounded-full bg-surface-tint font-black text-action`}>
      {initial}
    </span>
  );
}
