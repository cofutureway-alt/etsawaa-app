#!/bin/bash
# Deploy etsawaa.com: build locally for production, upload ONLY build/ (+ package
# files and PDF fonts), then the VPS rebuilds the runtime image and restarts.
# usage (Git Bash):  bash deploy/deploy.sh
set -e
cd "$(dirname "$0")/.."
KEY=~/.ssh/etsawa_vps
HOST=root@80.241.214.57
SITE_URL=https://etsawaa.com npm run build 2>&1 | grep -E "built in|fix-build-paths|rror" || true
TMP="$(mktemp -d)"
tar -czf "$TMP/etsawaa-build.tgz" build public/fonts package.json package-lock.json
scp -q -i $KEY "$TMP/etsawaa-build.tgz" deploy/Dockerfile deploy/docker-compose.yml deploy/remote-deploy.sh deploy/clamd.conf $HOST:/opt/etsawaa/
rm -rf "$TMP"
ssh -i $KEY $HOST 'bash /opt/etsawaa/remote-deploy.sh'
echo "Note: your local build/ now targets https://etsawaa.com — run 'npm run build' again before using npm start locally."
