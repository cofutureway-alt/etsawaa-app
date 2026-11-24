/**
 * A profile is complete when it has a name and two different phones (the
 * same rule checkout enforces on the shipping address). Shared by the Google
 * callback, the complete-profile page and the site-wide reminder banner.
 */
export function profileIsComplete(
  p: { full_name?: string | null; phone?: string | null; phone_alternate?: string | null } | null | undefined,
): boolean {
  return Boolean(p?.full_name?.trim() && p?.phone && p?.phone_alternate && p.phone !== p.phone_alternate);
}
