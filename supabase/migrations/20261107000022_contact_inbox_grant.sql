-- Admin → Contact inbox returned 500: "permission denied for table contact_messages".
-- Phase 04 revoked SELECT from authenticated (only INSERT for the forms); the
-- inbox migration (015) added the admin SELECT policy but never the table
-- grant, so RLS was never reached. Row-level security still limits reads to
-- people holding contact.manage (policy contact_admin_read).
grant select on public.contact_messages to authenticated;

-- contact_replies: anon never needs it (RLS already returns nothing); tidy the default grant
revoke all on public.contact_replies from anon;
