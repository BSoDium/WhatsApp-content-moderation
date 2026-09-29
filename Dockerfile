FROM node:24-alpine AS web-build

WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:24-alpine

# Lets docker-entrypoint.sh drop from root to the `node` user after fixing
# bind-mount ownership, instead of every deploy needing a host-side chown.
RUN apk add --no-cache su-exec

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.ts ./
COPY src ./src
COPY drizzle ./drizzle
COPY --from=web-build /web/dist ./web/dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Set from the git tag by .github/workflows/container.yml; a plain local
# `docker build` reports "dev". Declared late so a new value only invalidates
# the layers below it.
ARG APP_VERSION=dev
ENV NODE_ENV=production \
    APP_VERSION=$APP_VERSION

# auth_info/ (WhatsApp session keys) and data/ (SQLite — audit log, strikes,
# blocks, settings, and the moderation policy) are gitignored, host-owned
# state — see docs/decisions.md "auth_info/ is a credential". Mount them
# from the host; docker-entrypoint.sh fixes their ownership on every start.
VOLUME ["/app/auth_info", "/app/data"]

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "--experimental-strip-types", "index.ts"]
