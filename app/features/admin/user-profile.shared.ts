/** Profile tabs for Admin → Users → one user (shared by loader and page). */
export const SELLER_TABS = ["personal", "verification", "store", "stats", "orders", "withdrawals", "finance"] as const;
export const CUSTOMER_TABS = ["personal", "orders", "stats"] as const;
/** staff accounts: their permissions get a tab of their own (admins only see it) */
export const STAFF_TABS = ["personal", "permissions", "orders", "stats"] as const;
export type ProfileTab = (typeof SELLER_TABS)[number] | (typeof STAFF_TABS)[number];
export function profileTabs(isSeller: boolean, role: string): readonly string[] {
  return isSeller ? SELLER_TABS : role === "staff" ? STAFF_TABS : CUSTOMER_TABS;
}
