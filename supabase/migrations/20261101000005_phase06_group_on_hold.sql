-- PHASE 06 hotfix — order_vendor_groups.status gains 'on_hold' (the shipping
-- approval hold lives ON the group per PLAN §3 "group on_hold"); the CHECK
-- in phase 05 didn't list it. Also allow the hold state in the UI typing.
alter table public.order_vendor_groups drop constraint if exists order_vendor_groups_status_check;
alter table public.order_vendor_groups add constraint order_vendor_groups_status_check
  check (status in ('pending','preparing','on_hold','handed_to_carrier','out_for_delivery','delivered','cancelled'));
