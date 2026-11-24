-- Home hero mega menu: an image per top-level category, drawn in the panel's
-- empty space either as a soft background or as a picture in the corner.
-- Managed in admin → Mega menu (catalog.manage).
create table if not exists public.mega_menu_art (
  category_id uuid primary key references public.categories(id) on delete cascade,
  image_path  text not null check (length(image_path) between 3 and 300),
  mode        text not null default 'corner' check (mode in ('corner', 'background')),
  link_url    text not null default '' check (length(link_url) <= 500),
  is_active   boolean not null default true,
  updated_at  timestamptz not null default now()
);

alter table public.mega_menu_art enable row level security;

drop policy if exists mega_menu_art_read on public.mega_menu_art;
create policy mega_menu_art_read on public.mega_menu_art for select to anon, authenticated
  using (is_active or public.has_permission('catalog.manage'));

drop policy if exists mega_menu_art_write on public.mega_menu_art;
create policy mega_menu_art_write on public.mega_menu_art for all to authenticated
  using (public.has_permission('catalog.manage')) with check (public.has_permission('catalog.manage'));

grant select on public.mega_menu_art to anon, authenticated;
grant insert, update, delete on public.mega_menu_art to authenticated;

drop trigger if exists mega_menu_art_audit on public.mega_menu_art;
create trigger mega_menu_art_audit after insert or update or delete on public.mega_menu_art
  for each row execute function public.audit_row_change();
