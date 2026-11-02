-- ============================================================================
-- Phase 02 — Media + Catalog Setup
-- media_folders · media_files · categories · brands · tags · attribute_defs
-- attribute_options · category_attributes · buckets (media/documents)
-- RLS: owner-only media; public read only for active catalog nodes;
--      admin-only catalog writes (audit-logged).
-- ============================================================================

-- ---------------------------------------------------------------- media_folders
create table if not exists public.media_folders (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  parent_id  uuid references public.media_folders(id) on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 80),
  depth      int  not null default 1 check (depth between 1 and 3),
  created_at timestamptz not null default now()
);
-- NULL parent_id (root) must still count for the duplicate check:
create unique index if not exists media_folders_unique_name
  on public.media_folders (owner_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), name);

create or replace function public.fn_media_folder_depth() returns trigger
language plpgsql as $$
declare parent_depth int;
begin
  if new.parent_id is null then
    new.depth := 1;
  else
    select depth into parent_depth from public.media_folders where id = new.parent_id;
    if parent_depth is null then
      raise exception 'parent folder not found';
    end if;
    new.depth := parent_depth + 1;
    if new.depth > 3 then
      raise exception 'folder_depth_limit: folders nest at most 3 levels';
    end if;
    if new.owner_id is distinct from (select owner_id from public.media_folders where id = new.parent_id) then
      raise exception 'folder_parent_owner_mismatch';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_media_folder_depth on public.media_folders;
create trigger trg_media_folder_depth
  before insert or update of parent_id on public.media_folders
  for each row execute function public.fn_media_folder_depth();

-- ------------------------------------------------------------------ media_files
create table if not exists public.media_files (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  folder_id     uuid references public.media_folders(id) on delete set null,
  bucket        text not null check (bucket in ('media','documents')),
  path          text not null unique,           -- u/{uid}/{uuid}.{ext}
  original_name text not null default '',
  mime          text not null,
  size_bytes    bigint not null check (size_bytes > 0),
  kind          text not null check (kind in ('image','video','pdf','file')),
  width         int,
  height        int,
  deleted_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists media_files_owner_folder on public.media_files (owner_id, folder_id);
create index if not exists media_files_owner_active on public.media_files (owner_id) where deleted_at is null;

-- ------------------------------------------------------------------- categories
create table if not exists public.categories (
  id             uuid primary key default gen_random_uuid(),
  parent_id      uuid references public.categories(id) on delete restrict,
  depth          int  not null default 1 check (depth between 1 and 3),
  path           text not null default '',     -- slash-joined ancestor ids (self last)
  slug_ar        text not null,
  slug_en        text not null,
  name_ar        text not null,
  name_en        text not null,
  description_ar text not null default '',
  description_en text not null default '',
  thumb_path     text,                          -- media bucket object path
  sort           int  not null default 0,
  is_active      boolean not null default true,
  show_in_header boolean not null default false,
  deleted_at     timestamptz,
  created_at     timestamptz not null default now()
);
create unique index if not exists categories_slug_ar_unique on public.categories (slug_ar) where deleted_at is null;
create unique index if not exists categories_slug_en_unique on public.categories (slug_en) where deleted_at is null;
create index if not exists categories_parent_idx on public.categories (parent_id);

create or replace function public.fn_category_path() returns trigger
language plpgsql as $$
declare parent record;
begin
  if new.parent_id is null then
    new.depth := 1;
    new.path  := new.id::text;
  else
    -- cycle guard: a node can never be moved under its own descendant
    if exists (select 1 from public.categories where id = new.parent_id and path like new.id::text || '/%') then
      raise exception 'category_parent_cycle: cannot nest a category under its own descendant';
    end if;
    select id, depth, path into parent from public.categories where id = new.parent_id;
    if parent.id is null then
      raise exception 'category_parent_not_found';
    end if;
    if parent.depth >= 3 then
      raise exception 'category_depth_limit: categories nest at most 3 levels';
    end if;
    new.depth := parent.depth + 1;
    new.path  := parent.path || '/' || new.id::text;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_category_path on public.categories;
create trigger trg_category_path
  before insert or update of parent_id on public.categories
  for each row execute function public.fn_category_path();
-- repath descendants when a node moves
create or replace function public.fn_category_repath_children() returns trigger
language plpgsql as $$
declare old_prefix text; new_prefix text;
begin
  if new.parent_id is not distinct from old.parent_id then
    return new;
  end if;
  old_prefix := old.path;
  new_prefix := new.path;
  update public.categories
     set path = new_prefix || substring(c.path from length(old_prefix) + 1),
         depth = (array_length(string_to_array(new_prefix, '/'), 1)
                  + array_length(string_to_array(substring(c.path from length(old_prefix) + 1), '/'), 1) - 1)
    from (select id, path from public.categories where path like old_prefix || '/%') c
   where categories.id = c.id;
  return new;
end;
$$;
drop trigger if exists trg_category_repath on public.categories;
create trigger trg_category_repath
  after update of parent_id on public.categories
  for each row execute function public.fn_category_repath_children();

-- ----------------------------------------------------------------------- brands
create table if not exists public.brands (
  id         uuid primary key default gen_random_uuid(),
  name_ar    text not null,
  name_en    text not null,
  slug_ar    text not null,
  slug_en    text not null,
  thumb_path text,
  sort       int not null default 0,
  is_active  boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists brands_slug_ar_unique on public.brands (slug_ar) where deleted_at is null;
create unique index if not exists brands_slug_en_unique on public.brands (slug_en) where deleted_at is null;

-- ------------------------------------------------------------------------- tags
create table if not exists public.tags (
  id         uuid primary key default gen_random_uuid(),
  name_ar    text not null,
  name_en    text not null,
  slug       text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index if not exists tags_slug_unique on public.tags (slug) where deleted_at is null;
create unique index if not exists tags_name_ar_ci on public.tags (lower(name_ar)) where deleted_at is null;
create unique index if not exists tags_name_en_ci on public.tags (lower(name_en)) where deleted_at is null;

-- --------------------------------------------------------------- attribute_defs
create table if not exists public.attribute_defs (
  id              uuid primary key default gen_random_uuid(),
  category_id     uuid not null references public.categories(id) on delete cascade,
  code            text not null check (code ~ '^[a-z0-9_]{2,40}$'),
  type            text not null check (type in ('text','number','bool','enum','color')),
  unit            text not null default '',
  is_required     boolean not null default false,
  is_filterable   boolean not null default false,
  is_variant_axis boolean not null default false,
  sort            int not null default 0,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now()
);
create unique index if not exists attribute_defs_code_unique
  on public.attribute_defs (category_id, code) where deleted_at is null;
-- variant axes must be selectable types (never free text|number values)
alter table public.attribute_defs
  add constraint attribute_defs_axis_type
  check (not is_variant_axis or type in ('enum','color','bool'));

create or replace function public.fn_attribute_leaf_category() returns trigger
language plpgsql as $$
declare kids int;
begin
  select count(*) into kids from public.categories where parent_id = new.category_id and deleted_at is null;
  if kids > 0 then
    raise exception 'attribute_category_not_leaf: attributes attach to leaf categories only';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_attribute_leaf on public.attribute_defs;
create trigger trg_attribute_leaf
  before insert or update of category_id on public.attribute_defs
  for each row execute function public.fn_attribute_leaf_category();

-- ------------------------------------------------------------ attribute_options
create table if not exists public.attribute_options (
  id           uuid primary key default gen_random_uuid(),
  attribute_id uuid not null references public.attribute_defs(id) on delete cascade,
  code         text not null check (code ~ '^[a-z0-9_]{2,40}$'),
  label_ar     text not null,
  label_en     text not null,
  color_hex    text check (color_hex is null or color_hex ~ '^#[0-9a-fA-F]{6}$'),
  image_path   text,
  sort         int not null default 0,
  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  unique (attribute_id, code)
);

-- ---------------------------------------------------------- category_attributes
create table if not exists public.category_attributes (
  category_id  uuid not null references public.categories(id) on delete cascade,
  attribute_id uuid not null references public.attribute_defs(id) on delete cascade,
  sort         int not null default 0,
  primary key (category_id, attribute_id)
);

-- ---------------------------------------------------------------- settings.media
insert into public.settings (key, value)
values ('media', jsonb_build_object(
  'allow_images', true,
  'allow_video', false,
  'allow_pdf', false,
  'allowed_mimes', jsonb_build_array('image/jpeg','image/png','image/webp','image/gif'),
  'max_image_mb', 5,
  'max_video_mb', 50,
  'max_pdf_mb', 10,
  'max_dimensions_px', 4000
))
on conflict (key) do nothing;

-- ------------------------------------------------------------------- buckets
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', true, 52428800)
on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 52428800)
on conflict (id) do nothing;

-- storage policies (objects live at u/{uid}/{uuid}.{ext})
drop policy if exists "media_public_read" on storage.objects;
create policy "media_public_read" on storage.objects for select
  using (bucket_id = 'media');

drop policy if exists "media_owner_insert" on storage.objects;
create policy "media_owner_insert" on storage.objects for insert to authenticated
  with check (bucket_id in ('media','documents')
    and (storage.foldername(name))[1] = 'u'
    and (storage.foldername(name))[2] = auth.uid()::text);

drop policy if exists "media_owner_update" on storage.objects;
create policy "media_owner_update" on storage.objects for update to authenticated
  using (bucket_id in ('media','documents')
    and (storage.foldername(name))[1] = 'u'
    and (storage.foldername(name))[2] = auth.uid()::text);

drop policy if exists "media_owner_delete" on storage.objects;
create policy "media_owner_delete" on storage.objects for delete to authenticated
  using (bucket_id in ('media','documents')
    and (storage.foldername(name))[1] = 'u'
    and (storage.foldername(name))[2] = auth.uid()::text);

drop policy if exists "documents_owner_read" on storage.objects;
create policy "documents_owner_read" on storage.objects for select to authenticated
  using (bucket_id = 'documents'
    and (storage.foldername(name))[1] = 'u'
    and (storage.foldername(name))[2] = auth.uid()::text);

-- ------------------------------------------------------------------- RLS grants
revoke all on public.media_folders, public.media_files from anon, authenticated;
revoke all on public.categories, public.brands, public.tags from anon, authenticated;
revoke all on public.attribute_defs, public.attribute_options, public.category_attributes from anon, authenticated;

-- media: owner-only, every operation
grant select, insert, update, delete on public.media_folders to authenticated;
grant select, insert, update, delete on public.media_files to authenticated;
alter table public.media_folders enable row level security;
alter table public.media_files   enable row level security;
create policy media_folders_owner on public.media_folders
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy media_files_owner on public.media_files
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- catalog: public read of live rows only; admin-only writes
grant select on public.categories, public.brands, public.tags to anon, authenticated;
grant select on public.attribute_defs, public.attribute_options, public.category_attributes to authenticated;
grant insert, update, delete on public.categories, public.brands, public.tags,
  public.attribute_defs, public.attribute_options, public.category_attributes to authenticated;

alter table public.categories enable row level security;
alter table public.brands enable row level security;
alter table public.tags enable row level security;
alter table public.attribute_defs enable row level security;
alter table public.attribute_options enable row level security;
alter table public.category_attributes enable row level security;

create policy categories_read_public on public.categories
  for select to anon, authenticated using (is_active and deleted_at is null);
create policy categories_read_admin on public.categories
  for select to authenticated using (public.is_admin());
create policy categories_write_admin on public.categories
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy brands_read_public on public.brands
  for select to anon, authenticated using (is_active and deleted_at is null);
create policy brands_read_admin on public.brands
  for select to authenticated using (public.is_admin());
create policy brands_write_admin on public.brands
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy tags_read_public on public.tags
  for select to anon, authenticated using (deleted_at is null);
create policy tags_read_admin on public.tags
  for select to authenticated using (public.is_admin());
create policy tags_write_admin on public.tags
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy attribute_defs_read on public.attribute_defs
  for select to authenticated using (deleted_at is null or public.is_admin());
create policy attribute_defs_write_admin on public.attribute_defs
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy attribute_options_read on public.attribute_options
  for select to authenticated using (deleted_at is null or public.is_admin());
create policy attribute_options_write_admin on public.attribute_options
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy category_attributes_read on public.category_attributes
  for select to authenticated using (true);
create policy category_attributes_write_admin on public.category_attributes
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- --------------------------------------------------------- audit for catalog writes
create or replace function public.fn_audit_catalog() returns trigger
language plpgsql security definer set search_path = public as $$
declare actor uuid; entity text;
begin
  actor := auth.uid();
  if actor is null then
    return coalesce(new, old);   -- seed / SQL-level work is not audited
  end if;
  entity := tg_table_name;
  insert into public.audit_logs (actor, action, entity, entity_id, after)
  values (
    actor,
    case tg_op when 'INSERT' then 'catalog.create' when 'UPDATE' then 'catalog.update' else 'catalog.delete' end,
    entity,
    coalesce(new.id, old.id)::text,
    jsonb_build_object('op', tg_op, 'row', to_jsonb(coalesce(new, old)))
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_audit_categories on public.categories;
create trigger trg_audit_categories after insert or update or delete on public.categories
  for each row execute function public.fn_audit_catalog();
drop trigger if exists trg_audit_brands on public.brands;
create trigger trg_audit_brands after insert or update or delete on public.brands
  for each row execute function public.fn_audit_catalog();
drop trigger if exists trg_audit_tags on public.tags;
create trigger trg_audit_tags after insert or update or delete on public.tags
  for each row execute function public.fn_audit_catalog();
drop trigger if exists trg_audit_attribute_defs on public.attribute_defs;
create trigger trg_audit_attribute_defs after insert or update or delete on public.attribute_defs
  for each row execute function public.fn_audit_catalog();
drop trigger if exists trg_audit_attribute_options on public.attribute_options;
create trigger trg_audit_attribute_options after insert or update or delete on public.attribute_options
  for each row execute function public.fn_audit_catalog();
drop trigger if exists trg_audit_category_attributes on public.category_attributes;
create trigger trg_audit_category_attributes after insert or update or delete on public.category_attributes
  for each row execute function public.fn_audit_catalog();
