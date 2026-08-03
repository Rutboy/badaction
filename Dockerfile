# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e

FROM node:26.5.1-bookworm-slim@sha256:9e6f9357d371591e32ab6f2d8a26d63bdd0d17c29eee3f4f3e7e454d9634bf73 AS base

ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

RUN apt-get update \
  && apt-get install --yes --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

FROM base AS dependencies

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM dependencies AS builder

COPY . .
RUN mkdir -p public
RUN npm run prisma:generate
RUN npm run build
RUN npm run check:standalone

FROM dependencies AS migrator-dependencies

# Keep only the Prisma migration runtime and its required production packages.
RUN npm prune --omit=dev --omit=optional

FROM base AS migrator

ENV NODE_ENV=production

COPY --chown=node:node --from=migrator-dependencies /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node LICENSE ./LICENSE
COPY --chown=node:node THIRD_PARTY_NOTICES.md ./THIRD_PARTY_NOTICES.md
COPY --chown=node:node third-party-licenses ./third-party-licenses
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node prisma.config.ts ./prisma.config.ts
COPY --chown=node:node scripts/run-container-migrations.mjs ./scripts/run-container-migrations.mjs

USER node

CMD ["node", "scripts/run-container-migrations.mjs"]

FROM base AS runner

ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production
ENV PORT=3000

COPY --chown=node:node --from=builder /app/.next/standalone ./
COPY --chown=node:node --from=builder /app/.next/static ./.next/static
COPY --chown=node:node --from=builder /app/public ./public
COPY --chown=node:node LICENSE ./LICENSE
COPY --chown=node:node THIRD_PARTY_NOTICES.md ./THIRD_PARTY_NOTICES.md
COPY --chown=node:node scripts/run-server.mjs ./scripts/run-server.mjs
COPY --chown=node:node src/lib/runtime/application-lifecycle-protocol.ts ./src/lib/runtime/application-lifecycle-protocol.ts

USER node

EXPOSE 3000

STOPSIGNAL SIGTERM

HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/api/health', { signal: AbortSignal.timeout(2000) }).then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1));"]

CMD ["node", "scripts/run-server.mjs", "--standalone"]
