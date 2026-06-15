# Multi-stage build matching the Next.js "standalone" output pattern.
# Resulting runtime image is ~150 MB and runs as the `node` user.

FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml* package-lock.json* yarn.lock* ./
# --ignore-scripts skips sharp's postinstall (we don't use next/image, so the
# native sharp binary isn't needed at runtime). pnpm 10 makes ignored builds a
# fatal error in non-TTY contexts even when `pnpm.onlyBuiltDependencies` lists
# the package, so we bypass scripts entirely instead of fighting that check.
RUN \
  if   [ -f pnpm-lock.yaml ]; then pnpm install --frozen-lockfile --ignore-scripts; \
  elif [ -f yarn.lock ];      then yarn install --frozen-lockfile --ignore-scripts; \
  elif [ -f package-lock.json ]; then npm ci --ignore-scripts; \
  else npm install --ignore-scripts; \
  fi

FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN \
  if   [ -f pnpm-lock.yaml ]; then pnpm run build; \
  elif [ -f yarn.lock ];      then yarn build; \
  else npm run build; \
  fi

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 4000
ENV PORT=4000
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
