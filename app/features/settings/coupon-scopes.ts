/**
 * Coupon scopes (coupon_scopes table): include/exclude × vendor/category/
 * brand/product. The engine (c_scope_ok, called from fn_apply_coupon) already
 * reads these rows; the admin form just never wrote them.
 *
 * Pure parsers so the route action stays thin and the shape is testable.
 */

export type ScopeMode = "include" | "exclude";
export type ScopeKind = "vendor" | "category" | "brand" | "product";

export interface CouponScope {
  mode: ScopeMode;
  scope: ScopeKind;
  ref_id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODES: ScopeMode[] = ["include", "exclude"];
const KINDS: ScopeKind[] = ["vendor", "category", "brand", "product"];

/** Parse repeated form fields: scope_mode[], scope_kind[], scope_ref[]. */
export function parseScopes(form: FormData): CouponScope[] {
  const modes = form.getAll("scope_mode").map(String);
  const kinds = form.getAll("scope_kind").map(String);
  const refs = form.getAll("scope_ref").map((v) => String(v).trim());

  const out: CouponScope[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < refs.length; i += 1) {
    const mode = modes[i] as ScopeMode | undefined;
    const kind = kinds[i] as ScopeKind | undefined;
    const ref = refs[i];
    // Blank rows are the empty editor slot — skip silently.
    if (!ref) continue;
    if (!mode || !MODES.includes(mode)) continue;
    if (!kind || !KINDS.includes(kind)) continue;
    if (!UUID.test(ref)) continue;
    const key = `${mode}:${kind}:${ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ mode, scope: kind, ref_id: ref });
  }
  return out;
}

/**
 * A coupon cannot mix include and exclude — c_scope_ok applies exclude first
 * and then requires an include match, so a mixed set silently matches nothing.
 */
export function scopeConflict(scopes: CouponScope[]): boolean {
  const modes = new Set(scopes.map((s) => s.mode));
  return modes.size > 1;
}
