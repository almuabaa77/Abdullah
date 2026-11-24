FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json firebase-browser.js ./
RUN --mount=type=secret,id=registry_ca \
    if [ -r /run/secrets/registry_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/registry_ca; fi && \
    npm ci --no-audit --no-fund && npm run build:firebase && npm prune --omit=dev --no-audit --no-fund

FROM node:24-bookworm-slim
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --chown=node:node *.mjs ./
COPY --chown=node:node public ./public
COPY --from=build --chown=node:node /app/public/assets/firebase-auth.js ./public/assets/firebase-auth.js
RUN mkdir /data && chown node:node /data
ENV NODE_ENV=production DATABASE_PATH=/data/waslah.sqlite PORT=3000
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]
