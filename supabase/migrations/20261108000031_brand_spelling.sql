-- Brand name is spelled "إتسوء" (with hamza). Fix the stored copy that
-- visitors and sellers read. Audit history is left as it was recorded.
update public.settings set value = replace(value::text, 'اتسوء', 'إتسوء')::jsonb where value::text like '%اتسوء%';
update public.email_templates set subject_ar = replace(subject_ar, 'اتسوء', 'إتسوء') where subject_ar like '%اتسوء%';
update public.static_pages set content_ar = replace(content_ar, 'اتسوء', 'إتسوء') where content_ar like '%اتسوء%';
update public.blog_posts set
  excerpt_ar = replace(excerpt_ar, 'اتسوء', 'إتسوء'),
  content_ar = replace(content_ar, 'اتسوء', 'إتسوء'),
  seo_title_ar = replace(seo_title_ar, 'اتسوء', 'إتسوء'),
  seo_desc_ar = replace(seo_desc_ar, 'اتسوء', 'إتسوء')
where concat(excerpt_ar, content_ar, seo_title_ar, seo_desc_ar) like '%اتسوء%';
-- spelling only: the wording and meaning of the terms do not change
update public.legal_documents set body = replace(body::text, 'اتسوء', 'إتسوء')::jsonb where body::text like '%اتسوء%';
update public.notifications set payload = replace(payload::text, 'اتسوء', 'إتسوء')::jsonb where payload::text like '%اتسوء%';
update public.vendors set store_name_ar = replace(store_name_ar, 'اتسوء', 'إتسوء') where store_name_ar like '%اتسوء%';
