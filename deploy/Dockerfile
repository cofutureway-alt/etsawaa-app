# Runtime only: the app is built locally (npm run build) and only build/ is uploaded.
FROM node:22-bookworm-slim
# chromium: seller sitemap / order PDFs (playwright-core); Noto: Arabic glyphs in PDFs
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-noto-core ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production CHROME_PATH=/usr/bin/chromium PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY public/fonts ./public/fonts
COPY build ./build
USER node
EXPOSE 3000
CMD ["node", "--env-file=.env", "node_modules/@react-router/serve/bin.js", "./build/server/index.js"]
