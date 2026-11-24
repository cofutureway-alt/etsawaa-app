#!/bin/bash
# runs on the VPS in /opt/etsawaa: swap in the uploaded build, rebuild the runtime image, restart
set -e
cd /opt/etsawaa
# keep the previous builds' hashed assets: a visitor whose page was loaded
# before this deploy still fetches its old route chunks on the next click —
# without them that click fails ("404" on a valid page)
mkdir -p assets-keep
[ -d build/client/assets ] && cp -n build/client/assets/* assets-keep/ 2>/dev/null || true
find assets-keep -type f -mtime +21 -delete 2>/dev/null || true
rm -rf app scripts build public package.json package-lock.json react-router.config.ts vite.config.ts tsconfig.json
tar -xzf etsawaa-build.tgz && rm etsawaa-build.tgz
cp -n assets-keep/* build/client/assets/ 2>/dev/null || true
docker compose build 2>&1 | grep -E "ERROR|failed" | tail -6 || true
docker compose up -d 2>&1 | tail -1
s=starting
for i in $(seq 1 20); do s=$(docker inspect -f "{{.State.Health.Status}}" etsawaa-app); [ "$s" = healthy ] && break; sleep 3; done
echo "app: $s"
docker image prune -f >/dev/null
