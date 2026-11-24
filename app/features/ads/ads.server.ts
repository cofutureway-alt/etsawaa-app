import type { SupabaseClient } from "@supabase/supabase-js";
import { PRODUCT_CARD_COLUMNS, STORE_COLUMNS, type ProductCard, type StoreCard } from "~/features/storefront/api";

/** One live paid placement (v_active_ads). */
export interface ActiveAd {
  id: string;
  placement: string;
  section: string | null;
  spot: string | null;
  category_id: string | null;
  template: string | null;
  product_id: string | null;
  vendor_id: string;
  image_path: string | null;
  link_url: string | null;
  position: number;
}

/** Live campaigns of the given placements (order: the vendor's slot order). */
export async function getActiveAds(client: SupabaseClient, placements: string[]): Promise<ActiveAd[]> {
  const { data, error } = await client
    .from("v_active_ads")
    .select("id, placement, section, spot, category_id, template, product_id, vendor_id, image_path, link_url, position")
    .in("placement", placements)
    .order("position");
  if (error) return []; // ads never break a page
  return (data ?? []) as ActiveAd[];
}

/** Product cards for the ads' products (only listable ones). */
export async function getAdProductCards(client: SupabaseClient, ids: string[]): Promise<Map<string, ProductCard>> {
  const out = new Map<string, ProductCard>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return out;
  const { data } = await client.from("v_storefront_products").select(PRODUCT_CARD_COLUMNS)
    .in("id", unique).eq("is_listable", true).not("min_price_piastres", "is", null);
  for (const row of (data ?? []) as ProductCard[]) out.set(row.id, row);
  return out;
}

/**
 * Put the paid products of a list first (in slot order), without duplicates;
 * returns the list and which campaign each pinned product belongs to.
 */
export function pinAds<T extends { id: string }>(list: T[], ads: ActiveAd[], cards: Map<string, T>, max?: number) {
  const pinned: T[] = [];
  const campaignOf: Record<string, string> = {};
  for (const ad of ads) {
    const card = ad.product_id ? cards.get(ad.product_id) : undefined;
    if (!card || campaignOf[card.id]) continue;
    pinned.push(card);
    campaignOf[card.id] = ad.id;
  }
  const rest = list.filter((p) => !campaignOf[p.id]);
  const merged = [...pinned, ...rest];
  return { list: max ? merged.slice(0, max) : merged, campaignOf };
}

/**
 * "Featured store" (store_spotlight) campaigns as store cards, in random
 * order (fair rotation between paying stores), with the campaign of each
 * store for impression counting. Never throws: ads never break a page.
 */
export async function getSpotlightStores(client: SupabaseClient, max = 4): Promise<{ stores: StoreCard[]; campaignOf: Record<string, string> }> {
  const ads = await getActiveAds(client, ["store_spotlight"]);
  if (!ads.length) return { stores: [], campaignOf: {} };
  const ids = [...new Set(ads.map((a) => a.vendor_id))];
  const { data } = await client.from("v_storefront_stores").select(STORE_COLUMNS).in("id", ids).eq("status", "active").eq("is_listable", true);
  const stores = pickRandom((data ?? []) as StoreCard[], max);
  const campaignOf: Record<string, string> = {};
  for (const s of stores) { const ad = ads.find((a) => a.vendor_id === s.id); if (ad) campaignOf[s.id] = ad.id; }
  return { stores, campaignOf };
}

/** Random pick of n items (fresh per request). */
export function pickRandom<T>(items: T[], n: number): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, n);
}
