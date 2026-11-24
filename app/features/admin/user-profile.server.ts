import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "~/lib/supabase/admin";

/**
 * Data for Admin → Users → one user. Sellers get six tabs (personal, store,
 * statistics, orders, withdrawals, finance); everyone else gets account,
 * orders and statistics. Only the open tab's lists are queried.
 */

import { profileTabs, type ProfileTab } from "./user-profile.shared";

const PAGE = 20;

export interface ProfileData {
  profile: {
    id: string; full_name: string; email: string | null; phone: string | null; phone_alternate: string | null;
    avatar_url: string | null; role: string; staff_role: string | null; status: string; locale: string; created_at: string;
  };
  auth: { last_sign_in_at: string | null; email_confirmed_at: string | null } | null;
  vendor: Record<string, unknown> | null;
  tab: ProfileTab;
  overview: Record<string, unknown> | null;
  categories: Array<{ id: string; name_ar: string; name_en: string; depth: number; category_rate: number | null; override: number | null; effective: number | null }>;
  levels: Array<{ id: string; name_ar: string; name_en: string; icon: string; color: string; sort: number }>;
  badges: Array<{ id: string; name_ar: string; name_en: string; icon: string; color: string; description_ar: string; description_en: string }>;
  orders: Array<Record<string, unknown>>;
  ordersTotal: number;
  page: number;
  perPage: number;
  withdrawals: Array<Record<string, unknown>>;
  transactions: Array<Record<string, unknown>>;
  addresses: Array<Record<string, unknown>>;
  /** verification tab: every document image + status history */
  documents: Array<{ id: string; type: string; path: string; original_name: string; mime: string; status: string; reject_reason: string | null; review_note: string | null; created_at: string; reviewed_at: string | null }>;
  statusHistory: Array<{ id: string; field: string; from_value: string | null; to_value: string; reason: string | null; created_at: string; actor_name: string | null }>;
}

export async function loadUserProfile(client: SupabaseClient, userId: string, url: URL): Promise<ProfileData | null> {
  const [{ data: profile }, { data: vendor }] = await Promise.all([
    client.from("profiles").select("id, full_name, email, phone, phone_alternate, avatar_url, role, staff_role, status, locale, created_at").eq("id", userId).maybeSingle(),
    client.from("vendors")
      .select(`*, vendor_levels(id, name_ar, name_en, icon, color), governorates(name_ar, name_en), areas(name_ar, name_en)`)
      .eq("owner_id", userId).maybeSingle(),
  ]);
  if (!profile) return null;

  // sign-in facts live in auth.users (service client; admin route only)
  const admin = getSupabaseAdminClient();
  const authUser = admin ? (await admin.auth.admin.getUserById(userId)).data.user : null;

  const isSeller = Boolean(vendor);
  const tabs = profileTabs(isSeller, String((profile as { role?: string }).role ?? ""));
  const requested = url.searchParams.get("tab") ?? "personal";
  const tab = (tabs.includes(requested) ? requested : "personal") as ProfileTab;
  const page = Math.max(1, Math.trunc(Number(url.searchParams.get("page"))) || 1);
  const from = (page - 1) * PAGE;
  const vendorId = vendor ? (vendor.id as string) : null;

  const out: ProfileData = {
    profile: profile as ProfileData["profile"],
    auth: authUser ? { last_sign_in_at: authUser.last_sign_in_at ?? null, email_confirmed_at: authUser.email_confirmed_at ?? null } : null,
    vendor: (vendor as Record<string, unknown> | null) ?? null,
    tab, overview: null, categories: [], levels: [], badges: [], orders: [], ordersTotal: 0, page, perPage: PAGE,
    withdrawals: [], transactions: [], addresses: [], documents: [], statusHistory: [],
  };

  // headline numbers are shown on every tab
  const overview = vendorId
    ? await client.rpc("fn_admin_vendor_overview", { p_vendor: vendorId })
    : await client.rpc("fn_admin_customer_overview", { p_user: userId });
  out.overview = (overview.data as Record<string, unknown> | null) ?? null;

  if (vendorId && tab === "store") {
    const categoryIds = ((vendor!.category_ids as string[] | null) ?? []);
    const [{ data: overrides }, { data: levels }, { data: badges }] = await Promise.all([
      client.from("vendor_commission_overrides").select("category_id, percent").eq("vendor_id", vendorId),
      client.from("vendor_levels").select("id, name_ar, name_en, icon, color, sort").eq("is_active", true).order("sort"),
      client.from("vendor_badges").select("badges(id, name_ar, name_en, icon, color, description_ar, description_en)").eq("vendor_id", vendorId),
    ]);
    const overrideMap = new Map(((overrides ?? []) as Array<{ category_id: string; percent: number }>).map((o) => [o.category_id, Number(o.percent)]));
    // the store's chosen categories plus any category that already has an override
    const ids = [...new Set([...categoryIds, ...overrideMap.keys()])];
    const { data: cats } = ids.length
      ? await client.from("categories").select("id, name_ar, name_en, depth").in("id", ids)
      : { data: [] };
    out.categories = await Promise.all(((cats ?? []) as Array<{ id: string; name_ar: string; name_en: string; depth: number }>).map(async (c) => {
      const [rate, effective] = await Promise.all([
        client.rpc("fn_effective_commission", { p_category: c.id }),
        client.rpc("fn_vendor_line_commission", { p_vendor: vendorId, p_leaf: c.id }),
      ]);
      return {
        ...c,
        category_rate: rate.data == null ? null : Number(rate.data),
        override: overrideMap.get(c.id) ?? null,
        effective: effective.data == null ? null : Number(effective.data),
      };
    }));
    out.levels = (levels ?? []) as ProfileData["levels"];
    out.badges = ((badges ?? []) as unknown as Array<{ badges: ProfileData["badges"][number] | null }>).map((b) => b.badges).filter((b): b is ProfileData["badges"][number] => b !== null);
  }

  if (vendorId && tab === "verification") {
    const [docs, hist] = await Promise.all([
      client.from("vendor_documents").select("id, type, path, original_name, mime, status, reject_reason, review_note, created_at, reviewed_at")
        .eq("vendor_id", vendorId).order("type").order("created_at"),
      client.from("vendor_status_history").select("id, field, from_value, to_value, reason, created_at, actor")
        .eq("vendor_id", vendorId).order("created_at", { ascending: false }).limit(50),
    ]);
    out.documents = (docs.data ?? []) as ProfileData["documents"];
    const rows = (hist.data ?? []) as Array<{ id: string; field: string; from_value: string | null; to_value: string; reason: string | null; created_at: string; actor: string | null }>;
    const actorIds = [...new Set(rows.map((r) => r.actor).filter((a): a is string => Boolean(a)))];
    const { data: actors } = actorIds.length
      ? await client.from("profiles").select("id, full_name").in("id", actorIds)
      : { data: [] };
    const nameOf = new Map(((actors ?? []) as Array<{ id: string; full_name: string }>).map((a) => [a.id, a.full_name]));
    out.statusHistory = rows.map(({ actor, ...r }) => ({ ...r, actor_name: actor ? nameOf.get(actor) ?? null : null }));
  }

  if (tab === "orders") {
    if (vendorId) {
      const res = await client.from("order_vendor_groups")
        .select("id, status, items_subtotal_piastres, discount_piastres, commission_piastres, created_at, delivered_at, cancelled_at, orders(number, payment_method, payment_status, ship_name)", { count: "exact" })
        .eq("vendor_id", vendorId).order("created_at", { ascending: false }).order("id").range(from, from + PAGE - 1);
      out.orders = (res.data ?? []) as Array<Record<string, unknown>>;
      out.ordersTotal = res.count ?? 0;
    } else {
      const res = await client.from("orders")
        .select("id, number, status, payment_method, payment_status, total_piastres, created_at", { count: "exact" })
        .eq("user_id", userId).order("created_at", { ascending: false }).order("id").range(from, from + PAGE - 1);
      out.orders = (res.data ?? []) as Array<Record<string, unknown>>;
      out.ordersTotal = res.count ?? 0;
    }
  }

  if (vendorId && tab === "withdrawals") {
    const [w, tx] = await Promise.all([
      client.from("withdrawal_requests").select("id, amount_piastres, method, status, created_at, reviewed_at, cancel_reason")
        .eq("vendor_id", vendorId).order("created_at", { ascending: false }).limit(50),
      client.from("wallet_transactions").select("id, type, amount_piastres, reference, reason, created_at")
        .eq("vendor_id", vendorId).order("created_at", { ascending: false }).limit(100),
    ]);
    out.withdrawals = (w.data ?? []) as Array<Record<string, unknown>>;
    out.transactions = (tx.data ?? []) as Array<Record<string, unknown>>;
  }

  // addresses are owner-only under RLS; this admin-only route reads them
  // with the service client
  if (!vendorId && tab === "personal" && admin) {
    const { data: addresses } = await admin.from("user_addresses")
      .select("id, label, full_name, phone, address1, is_default, governorates(name_ar, name_en), areas(name_ar, name_en)")
      .eq("user_id", userId).order("is_default", { ascending: false });
    out.addresses = (addresses ?? []) as Array<Record<string, unknown>>;
  }

  return out;
}
