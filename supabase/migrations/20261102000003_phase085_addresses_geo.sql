-- ============================================================================
-- Etsawaa — Phase 08.5 H-21/H-22/H-23: address form completeness
--  - phone_alternate: the address carries its OWN alternate phone (prefilled
--    from profiles.phone_alternate on new addresses; checkout stops asking
--    for it separately when the saved address has one)
--  - lat/lng/geo_accuracy: optional delivery pin saved ON the address
--    (H-23). Coordinates are the buyer's own data; vendors NEVER see them
--    (order snapshot policy unchanged — fn_create_order stores the pin on
--    the order only for the courier hand-off, never exposed in vendor views).
-- ============================================================================
alter table public.user_addresses
  add column if not exists phone_alternate text,
  add column if not exists lat numeric(9,6),
  add column if not exists lng numeric(9,6),
  add column if not exists geo_accuracy integer check (geo_accuracy is null or (geo_accuracy between 1 and 5000));

-- a pin is complete or absent — never half a coordinate
alter table public.user_addresses drop constraint if exists user_addresses_pin_complete;
alter table public.user_addresses
  add constraint user_addresses_pin_complete
  check ((lat is null and lng is null) or (lat is not null and lng is not null));

-- plausible-Egypt bounding box (same envelope fn_create_order validates)
alter table public.user_addresses drop constraint if exists user_addresses_pin_bounds;
alter table public.user_addresses
  add constraint user_addresses_pin_bounds
  check (lat is null or (lat between 22 and 32.5 and lng between 24 and 37.5));
