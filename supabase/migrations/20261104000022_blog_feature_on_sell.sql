-- Blog: an article can be featured on the "Sell on Etsawaa" page.
-- Public read is unchanged (published posts only); the sell page lists
-- published posts with this flag, newest first.
alter table public.blog_posts
  add column if not exists feature_on_sell boolean not null default false;

create index if not exists blog_posts_feature_on_sell_idx
  on public.blog_posts (published_at desc)
  where feature_on_sell and status = 'published';
