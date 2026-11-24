-- Customers could never save their alternate phone: phase-05 added
-- profiles.phone_alternate but the column-level UPDATE grant (phase-01:
-- full_name, phone, avatar_url, locale) was not extended, so the profile page
-- and the complete-profile step failed with "permission denied".
grant update (phone_alternate) on public.profiles to authenticated;

-- same shape as checkout's orders.phone_alternate, and never equal to phone
alter table public.profiles drop constraint if exists profiles_phone_alternate_e164;
alter table public.profiles add constraint profiles_phone_alternate_e164
  check (phone_alternate is null or phone_alternate ~ '^\+201(0|1|2|5)[0-9]{8}$') not valid;
alter table public.profiles drop constraint if exists profiles_phones_differ;
alter table public.profiles add constraint profiles_phones_differ
  check (phone_alternate is null or phone is null or phone_alternate <> phone) not valid;
