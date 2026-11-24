-- Admin users list: a sign-up creates its account right away but it stays
-- unusable until the email code is entered. The list showed such accounts as
-- "active"; this tells it which of the listed users never confirmed.
create or replace function public.fn_admin_unconfirmed(p_ids uuid[])
returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(u.id), '{}')
  from auth.users u
  where u.id = any(p_ids) and u.email_confirmed_at is null
    and (public.has_permission('users.view') or public.is_admin());
$$;
revoke all on function public.fn_admin_unconfirmed(uuid[]) from public, anon;
grant execute on function public.fn_admin_unconfirmed(uuid[]) to authenticated;
