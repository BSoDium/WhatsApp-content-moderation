FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.js ./
COPY src ./src
COPY config/policy.example.md ./config/policy.example.md

ENV NODE_ENV=production

# auth_info/ (WhatsApp session keys), data/ (SQLite audit log) and
# config/policy.md (the real moderation policy) are all gitignored,
# host-owned state — see docs/decisions.md "auth_info/ is a credential".
# Mount them from the host; policy.md specifically must be bind-mounted
# since the image only ships the example template.
VOLUME ["/app/auth_info", "/app/data", "/app/config"]

USER node

CMD ["node", "index.js"]
