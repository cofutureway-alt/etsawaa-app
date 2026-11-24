import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MediaImg } from "~/components/catalog/MediaImg";
import { GalleryLightbox } from "~/components/catalog/GalleryLightbox";
import { CameraIcon } from "~/components/ui/icons";
import { NotificationBellLink } from "~/features/notifications/NotificationBellLink";
import { useProfileImage } from "./useProfileImage";

/**
 * Account identity card (H-01 redesign, owner round 5).
 *
 * The cover is a real 3:1 strip above the content instead of a background
 * behind it: a background image can only stretch to the content's height, so
 * it was cropped to a sliver, and the red scrim needed to make text readable
 * painted over the photo. Here the cover is untouched and the text sits under
 * it on the brand surface (contrast is guaranteed, not fought for).
 *
 * Both images are clickable (full-screen viewer) and editable inline, from
 * every account tab — the buttons are part of the shared layout.
 */
export function IdentityCard({
  lang,
  fullName,
  phone,
  avatarPath,
  bannerPath,
  unread,
}: {
  lang: string;
  fullName: string | null;
  phone: string | null;
  avatarPath: string | null;
  bannerPath: string | null;
  unread: number;
}) {
  const { t } = useTranslation();
  const avatar = useProfileImage("avatar");
  const banner = useProfileImage("banner");
  const [viewing, setViewing] = useState<"avatar" | "banner" | null>(null);
  const first = fullName?.trim()?.[0] ?? "؟";

  const viewed = viewing === "avatar" ? avatarPath : viewing === "banner" ? bannerPath : null;

  return (
    <section aria-label={t("account.title")} className="mb-5 overflow-hidden rounded-lg border border-border bg-surface shadow-1">
      {/* cover — exact 3:1, no overlay, the photo is shown as uploaded */}
      <div className="relative aspect-[3/1] w-full bg-surface-tint">
        {bannerPath ? (
          <button
            type="button"
            onClick={() => setViewing("banner")}
            aria-label={t("profile.viewImage", { name: t("profile.banner") })}
            className="group block size-full cursor-zoom-in"
          >
            <MediaImg
              path={bannerPath}
              alt=""
              width={1500}
              height={500}
              priority
              className="size-full object-cover transition-opacity duration-150 group-hover:opacity-95"
            />
          </button>
        ) : (
          <div className="flex size-full items-center justify-center bg-surface-tint">
            <span className="text-xs font-bold text-text-muted">{t("profile.noBanner")}</span>
          </div>
        )}

        {/* always-visible edit pill — matches the media-library tile controls */}
        <button
          type="button"
          onClick={() => banner.inputRef.current?.click()}
          disabled={banner.busy}
          className="absolute end-3 bottom-3 z-10 inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full bg-surface/95 px-3 text-xs font-bold text-text shadow-1 transition-colors duration-150 hover:bg-surface hover:text-action disabled:cursor-wait disabled:opacity-70"
        >
          <CameraIcon aria-hidden="true" width={14} height={14} />
          {banner.busy ? t("returns.evidenceUploading") : t("profile.changeBanner")}
        </button>
        <input
          ref={banner.inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif,.avif"
          className="sr-only"
          tabIndex={-1}
          onChange={banner.onChange}
        />
      </div>

      {/* identity row */}
      <div className="flex flex-col items-center gap-3 bg-side p-5 text-center text-side-text sm:flex-row sm:flex-wrap sm:gap-4 sm:text-start">
        <div className="relative shrink-0">
          {avatarPath ? (
            <button
              type="button"
              onClick={() => setViewing("avatar")}
              aria-label={t("profile.viewImage", { name: t("profile.avatar") })}
              className="block cursor-zoom-in"
            >
              <MediaImg
                path={avatarPath}
                alt=""
                width={64}
                height={64}
                className="size-16 rounded-full border-2 border-white/40 object-cover"
              />
            </button>
          ) : (
            <span
              aria-hidden="true"
              className="flex size-16 items-center justify-center rounded-full bg-surface text-2xl font-black text-action"
            >
              {first}
            </span>
          )}
          {/* the camera sits BESIDE the photo: nesting a button in the zoom
              button would be invalid HTML and unreachable by keyboard */}
          <button
            type="button"
            onClick={() => avatar.inputRef.current?.click()}
            disabled={avatar.busy}
            title={t("profile.changeAvatar")}
            aria-label={avatar.busy ? t("returns.evidenceUploading") : t("profile.changeAvatar")}
            className="absolute -bottom-0.5 -end-0.5 flex size-7 cursor-pointer items-center justify-center rounded-full bg-action text-on-action ring-2 ring-side transition-colors duration-150 hover:bg-action-hover disabled:cursor-wait disabled:opacity-70"
          >
            <CameraIcon aria-hidden="true" width={13} height={13} />
          </button>
          <input
            ref={avatar.inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif,.avif"
            className="sr-only"
            tabIndex={-1}
            onChange={avatar.onChange}
          />
        </div>

        <div className="min-w-0 flex-1">
          <h1 className="break-words text-base font-extrabold text-side-text-strong sm:text-lg">
            {fullName || t("account.title")}
          </h1>
          {phone ? (
            <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-2xs font-bold text-side-text-strong">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={11} height={11}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
              <span className="num" dir="ltr">{phone}</span>
            </p>
          ) : null}
        </div>

        <div className="flex w-full items-center justify-center gap-2 sm:w-auto">
          <NotificationBellLink lang={lang} initialCount={unread} />
          <form method="post" action={`/${lang}/auth/logout`}>
            <button
              type="submit"
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-white/30 px-4 text-sm font-bold text-side-text-strong transition-colors duration-150 hover:bg-white/10"
            >
              {t("nav.logout")}
            </button>
          </form>
        </div>
      </div>

      {avatar.dialog}
      {banner.dialog}

      {viewed ? (
        <GalleryLightbox
          open
          items={[{ id: viewing ?? "image", path: viewed }]}
          index={0}
          alt={fullName ?? ""}
          label={t(viewing === "avatar" ? "profile.avatar" : "profile.banner")}
          onIndexChange={() => {}}
          onClose={() => setViewing(null)}
        />
      ) : null}
    </section>
  );
}
