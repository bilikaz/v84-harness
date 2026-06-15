# Dev image for apps/knowledge (Hono + kysely). Source is bind-mounted via
# compose, so edits hot-reload; this image only builds the dependency layer.
# Node 24's native TS stripping means no build step.

FROM node:24-alpine

WORKDIR /app

# pnpm via corepack (matches the root packageManager pin)
RUN corepack enable

# Lockfile + workspace manifests first, for dependency-layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/knowledge/package.json ./apps/knowledge/

RUN pnpm install --frozen-lockfile --filter @v84-harness/knowledge...

# Include source so the image boots standalone; compose bind-mounts override it.
COPY apps/knowledge ./apps/knowledge

EXPOSE 3000

CMD ["pnpm", "--filter", "@v84-harness/knowledge", "dev"]
