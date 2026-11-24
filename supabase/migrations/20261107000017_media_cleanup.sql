-- Media retention (owner rule 2026-11-07): uploaded files that nothing uses
-- are deleted once they are older than 30 days.
--
-- "Used" is decided by scanning EVERY text / varchar / json / array column of
-- every public table for storage paths (u/{uuid}/{uuid}.ext, inbox/YYYY-MM/…),
-- including URL-encoded ones (/api/media?path=u%2F…) and rich-text HTML. Soft-
-- deleted rows count as users (an archived product keeps its photos so it can
-- be restored). The media library registry (media_files) itself is not a use.
-- Only service_role may run these; the app's cleanup worker calls them.

create table if not exists public.media_cleanup_runs (
  id bigserial primary key,
  ran_at timestamptz not null default now(),
  days int not null,
  candidates int not null default 0,
  deleted int not null default 0,
  freed_bytes bigint not null default 0,
  failed int not null default 0,
  detail jsonb not null default '{}'::jsonb
);
alter table public.media_cleanup_runs enable row level security;
drop policy if exists media_cleanup_runs_admin_read on public.media_cleanup_runs;
create policy media_cleanup_runs_admin_read on public.media_cleanup_runs
  for select to authenticated using (public.has_permission('media.manage'));

create or replace function public.fn_media_referenced_paths()
returns table(path text)
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  parts text[] := '{}';
  pat constant text := '(u/[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}\.[A-Za-z0-9]{2,5}|inbox/[0-9]{4}-[0-9]{2}/[0-9a-fA-F-]{36}\.[A-Za-z0-9]{2,5})';
begin
  for r in
    select c.table_name, c.column_name
      from information_schema.columns c
      join information_schema.tables t using (table_schema, table_name)
     where c.table_schema = 'public'
       and t.table_type = 'BASE TABLE'
       and c.data_type in ('text', 'character varying', 'jsonb', 'json', 'ARRAY')
       and c.table_name not in ('media_files', 'media_cleanup_runs')
  loop
    parts := parts || format(
      'select (regexp_matches(regexp_replace(%1$I::text, %2$L, %3$L, %4$L), %5$L, %4$L))[1] from public.%6$I where %1$I::text ~* %7$L',
      r.column_name, '%2F', '/', 'gi', pat, r.table_name, '(u/|u%2F|inbox/|inbox%2F)');
  end loop;
  if array_length(parts, 1) is null then return; end if;
  return query execute 'select distinct p from (' || array_to_string(parts, ' union all ') || ') s(p)';
end;
$$;

create or replace function public.fn_media_cleanup_candidates(p_days int default 30, p_limit int default 500)
returns table(bucket_id text, name text, size_bytes bigint, media_file_id uuid, created_at timestamptz)
language plpgsql
security definer
set search_path = public, storage
as $$
begin
  return query
  with ref as (select distinct r.path from public.fn_media_referenced_paths() r)
  select o.bucket_id::text, o.name::text, coalesce((o.metadata->>'size')::bigint, 0), mf.id, o.created_at
    from storage.objects o
    left join public.media_files mf on mf.bucket = o.bucket_id and mf.path = o.name
   where o.bucket_id in ('media', 'documents', 'contact')
     and o.name ~ '^(u/|inbox/)'
     and o.created_at < now() - make_interval(days => greatest(p_days, 0))
     and not exists (select 1 from ref where ref.path = o.name)
   order by o.created_at
   limit greatest(least(p_limit, 1000), 1);
end;
$$;

revoke all on function public.fn_media_referenced_paths() from public, anon, authenticated;
revoke all on function public.fn_media_cleanup_candidates(int, int) from public, anon, authenticated;
grant execute on function public.fn_media_referenced_paths() to service_role;
grant execute on function public.fn_media_cleanup_candidates(int, int) to service_role;
