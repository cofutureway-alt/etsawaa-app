# Production (etsawaa.com)

- **Where:** VPS 80.241.214.57, folder `/opt/etsawaa` (Docker container `etsawaa-app`, no public port).
- **In front:** Cloudflare (proxied, SSL mode Full) → `supabase-caddy` → `etsawaa-app:3000`.
  Caddy site config: `/opt/supabase/volumes/proxy/caddy/etsawaa.caddy` (imported by the Supabase Caddyfile; `tls internal`).
- **Secrets:** only in `/opt/etsawaa/.env` on the server (owner uid 1000, mode 600). Never commit them.
- **Deploy:** `bash deploy/deploy.sh` (Git Bash). Builds locally with `SITE_URL=https://etsawaa.com`, uploads `build/` only.
- **Logs:** `ssh … 'docker logs --tail 100 etsawaa-app'`
- **Windows builds:** `scripts/fix-build-paths.mjs` (postbuild) rewrites the baked `build\client` path so assets resolve on Linux.
