import { useEffect, useState } from "react";
import type { Route } from "./+types/tags";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/Button";
import { Input } from "~/components/ui/Input";
import { Dialog } from "~/components/ui/Overlay";
import { useToast } from "~/components/ui/Toast";
import { TrashIcon } from "~/components/ui/icons";
import { requirePanelAccess } from "~/lib/auth/guards";
import { requireLang } from "~/lib/lang.server";
import { createSupabaseServerClient } from "~/lib/supabase/server";
import { SkeletonTable } from "~/components/ui/Skeleton";
import { RouteErrorBoundary } from "~/components/layout/RouteErrorBoundary";


interface TagRow {
  id: string;
  name_ar: string;
  name_en: string;
  slug: string;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) throw Response.redirect(new URL(`/${lang}/auth/login?error=db`, request.url).toString(), 302);
  await requirePanelAccess(client, lang, "admin", request);
  const { data: rows, error } = await client
    .from("tags")
    .select("id,name_ar,name_en,slug")
    .is("deleted_at", null)
    .order("name_ar");
  if (error) throw new Response(error.message, { status: 500 });
  return { tags: (rows ?? []) as TagRow[] };
}

export async function action({ request, params }: Route.ActionArgs) {
  const lang = requireLang(params);
  const { client } = createSupabaseServerClient(request);
  if (!client) return { ok: false as const, reason: "db" };
  // Writes are is_admin()-gated in RLS, but the loader-only guard meant a
  // non-admin POST surfaced a raw DB error instead of a 403.
  await requirePanelAccess(client, lang, "admin", request);
  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "create") {
    const nameAr = String(form.get("name_ar") ?? "").trim();
    const nameEn = String(form.get("name_en") ?? "").trim();
    if (!nameAr || !nameEn) return { ok: false as const, reason: "invalid" };
    const slug = `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const { error } = await client.from("tags").insert({ name_ar: nameAr, name_en: nameEn, slug });
    if (error) return { ok: false as const, reason: error.message.includes("duplicate") ? "duplicate" : error.message };
    return { ok: true as const };
  }
  if (intent === "delete") {
    const { error } = await client
      .from("tags")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", String(form.get("id") ?? ""));
    if (error) return { ok: false as const, reason: "error" };
    return { ok: true as const };
  }
  return { ok: false as const, reason: "invalid" };
}

export default function AdminTags({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const fetcher = useFetcher<typeof action>();
  const { tags } = loaderData;
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [deleting, setDeleting] = useState<TagRow | null>(null);
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      if (fetcher.data.ok) {
        toast.showToast("success", t("catalog.saved"));
        setNameAr("");
        setNameEn("");
        setDeleting(null);
      } else {
        toast.showToast("error", fetcher.data.reason === "duplicate" ? t("catalog.tagDuplicate") : t("catalog.saveFailed"));
      }
    }
  }, [fetcher.state, fetcher.data, toast, t]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-extrabold text-text">{t("catalog.tags")}</h1>

      <fetcher.Form method="post" className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface p-3">
        <input type="hidden" name="intent" value="create" />
        <div className="w-56"><Input label={t("catalog.nameAr")} name="name_ar" value={nameAr} onChange={(e) => setNameAr(e.target.value)} required maxLength={40} inputClassName="bg-surface" /></div>
        <div className="w-56"><Input label={t("catalog.nameEn")} name="name_en" value={nameEn} onChange={(e) => setNameEn(e.target.value)} required maxLength={40} dir="ltr" inputClassName="bg-surface" /></div>
        <Button type="submit" loading={busy}>{t("catalog.addTag")}</Button>
      </fetcher.Form>

      <ul className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <li key={tag.id} className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-sm font-bold text-text">
            {tag.name_ar}
            <span className="font-normal text-text-faint">/ {tag.name_en}</span>
            <button type="button" aria-label={t("common.delete")} onClick={() => setDeleting(tag)} className="cursor-pointer text-text-muted hover:text-danger">
              <TrashIcon className="size-3.5" />
            </button>
          </li>
        ))}
        {tags.length === 0 ? <li className="rounded-lg border border-dashed border-border bg-surface py-10 text-center text-sm text-text-muted w-full">{t("catalog.noTags")}</li> : null}
      </ul>

      <Dialog open={deleting !== null} onClose={() => setDeleting(null)} title={t("common.confirm")}>
        {deleting ? (
          <fetcher.Form method="post" className="flex flex-col gap-3">
            <input type="hidden" name="intent" value="delete" />
            <input type="hidden" name="id" value={deleting.id} />
            <p className="text-sm text-text">{t("catalog.deleteConfirm", { name: deleting.name_ar })}</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setDeleting(null)}>{t("common.cancel")}</Button>
              <Button type="submit" loading={busy}>{t("common.confirm")}</Button>
            </div>
          </fetcher.Form>
        ) : null}
      </Dialog>
    </div>
  );
}

/** H-24: shown while the client hydrates / while the loader streams — stable shapes, CLS 0. */
export function HydrateFallback() {
  return <SkeletonTable />;
}

/**
 * Without a route boundary a loader throw (or a guard redirect) escaped the
 * panel layout and rendered the standalone root error document, losing the
 * sidebar. Every other admin route already had one.
 */
export function ErrorBoundary() {
  return <RouteErrorBoundary />;
}
