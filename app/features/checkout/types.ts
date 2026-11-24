/**
 * Shared row shapes returned by the checkout loader (JOURNEYS §6).
 *
 * Client-safe by design: no server code here, so both the route components
 * and `checkout.server.ts` can import these types (the server file imports
 * them for its DB casts, the presentational components for their props).
 */

/** One saved user address as loaded for the checkout accordion. */
export interface CheckoutAddressRow {
  id: string;
  label: string | null;
  full_name: string;
  phone: string;
  phone_alternate: string | null;
  governorate_id: number;
  area_id: number;
  address1: string;
  address2: string | null;
  postal_code: string | null;
  is_default: boolean;
  lat: number | null;
  lng: number | null;
  geo_accuracy: number | null;
}

/** One active governorate with its single per-order shipping fee. */
export interface CheckoutGovernorateRow {
  id: number;
  name_ar: string;
  name_en: string;
  shipping_fee_piastres: number;
  is_active: boolean;
}

/** One active area, scoped to its governorate. */
export interface CheckoutAreaRow {
  id: number;
  governorate_id: number;
  name_ar: string;
  name_en: string;
  is_active: boolean;
}
