import { useTranslation } from "react-i18next";
import { publicMediaUrl } from "~/lib/media.shared";

/**
 * Old → new table for a store settings change request. Used by the seller
 * (what is waiting for review) and by the admin review queue. Lookups turn
 * ids (categories, governorate, area) into names; image paths render as
 * thumbnails.
 */

export interface ChangeRequest {
  id: string;
  changes: Record<string, unknown>;
  previous: Record<string, unknown>;
  status: string;
  reason: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export interface ChangeLookups {
  categories: Map<string, string>;
  governorates: Map<string, string>;
  areas: Map<string, string>;
  supabaseUrl: string;
}

const IMAGE_FIELDS = new Set(["logo_path", "banner_path"]);

export function ChangeDiff({ changes, previous, lookups }: { changes: Record<string, unknown>; previous: Record<string, unknown>; lookups: ChangeLookups }) {
  const { t } = useTranslation();
  const fields = Object.keys(changes);

  const render = (field: string, value: unknown) => {
    if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) return <span className="text-text-faint">—</span>;
    if (IMAGE_FIELDS.has(field)) {
      return <img src={publicMediaUrl(lookups.supabaseUrl, String(value))} alt="" className={`${field === "logo_path" ? "size-12" : "h-12 w-28"} rounded border border-border object-cover`} />;
    }
    if (field === "category_ids" && Array.isArray(value)) {
      return <span>{value.map((id) => lookups.categories.get(String(id)) ?? "?").join("، ")}</span>;
    }
    if (field === "governorate_id") return <span>{lookups.governorates.get(String(value)) ?? String(value)}</span>;
    if (field === "area_id") return <span>{lookups.areas.get(String(value)) ?? String(value)}</span>;
    if (field === "socials" && typeof value === "object") {
      const rows = Object.entries(value as Record<string, string>).filter(([, v]) => v);
      return rows.length ? <span className="flex flex-col" dir="ltr">{rows.map(([k, v]) => <span key={k}>{k}: {v}</span>)}</span> : <span className="text-text-faint">—</span>;
    }
    return <span className="break-words" dir={field.endsWith("_en") || field === "phone" ? "ltr" : undefined}>{String(value)}</span>;
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed text-sm">
        <thead>
          <tr className="text-xs text-text-muted">
            <th className="py-1.5 text-start font-bold">{t("storeChange.field")}</th>
            <th className="py-1.5 text-start font-bold">{t("storeChange.old")}</th>
            <th className="py-1.5 text-start font-bold">{t("storeChange.new")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {fields.map((f) => (
            <tr key={f} className="align-top">
              <td className="py-2 pe-3 font-bold text-text">{t(`storeChange.f.${f}`)}</td>
              <td className="py-2 pe-3 text-text-muted line-through decoration-danger/50">{render(f, previous[f])}</td>
              <td className="py-2 font-bold text-success-strong">{render(f, changes[f])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
