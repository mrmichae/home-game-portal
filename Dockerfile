FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.server.json vite.config.ts vitest.config.ts index.html ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=8090 \
    ROM_LIBRARY_PATH=/roms \
    DATA_DIR=/data \
    SAVES_DIR=/saves \
    ARTWORK_DIR=/artwork

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY migrations ./migrations

RUN mkdir -p /roms /data /saves /artwork && chown -R node:node /app /data /saves /artwork

EXPOSE 8090
VOLUME ["/data", "/saves", "/artwork"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8090/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

USER node
CMD ["node", "dist/server/index.js"]
