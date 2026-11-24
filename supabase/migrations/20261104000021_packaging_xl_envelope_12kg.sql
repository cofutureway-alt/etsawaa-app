-- Price sheet: the Arabic tab said the extra-large envelope holds up to 10 kg,
-- the English tab said 12 kg. Confirmed by the owner: 12 kg is correct.
-- Catalog row only; past packaging orders keep the name they were placed with.
update public.packaging_items
   set sku = 'ENV-XL-12',
       name_ar = 'ظرف كبير جداً حتى 12 كجم',
       name_en = 'Extra-large envelope ≤ 12 kg',
       updated_at = now()
 where sku = 'ENV-XL-10';
