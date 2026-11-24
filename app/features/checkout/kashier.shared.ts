/** Kashier settings shape — shared by the server module and the admin settings page. */

export type TestScope = "off" | "admins" | "everyone";
export const KASHIER_METHODS = ["card", "wallet", "bank_installments"] as const;
export type KashierMethod = (typeof KASHIER_METHODS)[number];

export interface KashierSettings {
  enabled: boolean;
  testScope: TestScope;
  /** empty = every method enabled on the Kashier account */
  methods: KashierMethod[];
}

export function parseKashierSettings(value: unknown): KashierSettings {
  const v = (value ?? {}) as Record<string, unknown>;
  const scope = v.kashier_test_mode === "admins" || v.kashier_test_mode === "everyone" ? v.kashier_test_mode : "off";
  const list = Array.isArray(v.kashier_methods) ? (v.kashier_methods as unknown[]) : typeof v.kashier_methods === "string" ? [v.kashier_methods] : null;
  const methods = list
    ? list.filter((m): m is KashierMethod => (KASHIER_METHODS as readonly string[]).includes(String(m)))
    : [];
  return { enabled: v.kashier_enabled !== false && v.kashier_enabled !== "false", testScope: scope, methods };
}

