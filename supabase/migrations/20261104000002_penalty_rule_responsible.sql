-- ============================================================================
-- Penalty rules: the team member responsible for a fine
--
-- Each rule can name the admin/staff member who owns it (follows up, decides
-- waivers). Optional; cleared automatically if that profile is deleted.
-- ============================================================================
begin;

alter table public.penalty_rules
  add column if not exists responsible_id uuid references public.profiles(id) on delete set null;

-- only admins/staff can be responsible
create or replace function public.fn_penalty_rule_responsible_check()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.responsible_id is not null and not exists (
    select 1 from public.profiles p where p.id = new.responsible_id and p.role in ('admin', 'staff')
  ) then
    raise exception 'responsible_not_staff' using errcode = '23514';
  end if;
  return new;
end
$function$;

drop trigger if exists trg_penalty_rule_responsible on public.penalty_rules;
create trigger trg_penalty_rule_responsible
  before insert or update of responsible_id on public.penalty_rules
  for each row execute function public.fn_penalty_rule_responsible_check();

revoke execute on function public.fn_penalty_rule_responsible_check() from public, anon, authenticated;

commit;
