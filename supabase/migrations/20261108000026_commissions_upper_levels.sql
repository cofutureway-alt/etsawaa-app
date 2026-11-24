-- Commission table (جدول عمولات اتسوء): the 170 third-level categories already carry the
-- lowest («من») rate of the sheet. The 10 main and 38 sub categories had no rate of their
-- own, so the admin screens showed «—» for them and a category added later under them
-- would fall back to the vendor-level 5%. Each main / sub category now gets the LOWEST rate
-- among its own third-level categories (the owner's rule: pick the lower value).
-- Existing third-level rates are not touched.
insert into public.category_commissions (category_id, percent, updated_at)
select c.id, min(cc.percent), now()
  from public.categories c
  join public.categories d on d.depth = 3 and d.deleted_at is null and public.fn_category_within(d.id, c.id)
  join public.category_commissions cc on cc.category_id = d.id
 where c.deleted_at is null and c.depth in (1, 2)
 group by c.id
on conflict (category_id) do update set percent = excluded.percent, updated_at = now();
