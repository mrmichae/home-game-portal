# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY tsconfig.json tsconfig.server.json vite.config.ts vitest.config.ts index.html ./
COPY scripts ./scripts
COPY src ./src
COPY public ./public
RUN npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8090 \
    ROM_LIBRARY_PATH=/roms \
    DATA_DIR=/data \
    SAVES_DIR=/saves \
    ARTWORK_DIR=/artwork

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force

COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node THIRD_PARTY_LICENSES ./THIRD_PARTY_LICENSES
COPY --chown=node:node THIRD_PARTY_NOTICES.md ./THIRD_PARTY_NOTICES.md

RUN mkdir -p /roms /data /saves /artwork && chown -R node:node /data /saves /artwork

EXPOSE 8090
VOLUME ["/data", "/saves", "/artwork"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8090/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

USER node
STOPSIGNAL SIGTERM
CMD ["node", "dist/server/index.js"]
