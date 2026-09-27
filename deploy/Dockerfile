# Build context is the repository root:
#   docker build -f deploy/Dockerfile .
# node:24-slim (glibc), not alpine: the pnpm lockfile pins glibc builds of
# rollup/esbuild native binaries; on musl the vite build fails with
# "Cannot find module '@rollup/rollup-linux-x64-musl'"
FROM node:24-slim AS build
RUN npm install -g pnpm@10
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile

ENV NODE_ENV=production
RUN pnpm --filter @workspace/api-server run build
# vite.config.ts requires PORT and BASE_PATH at config-load time
RUN PORT=20302 BASE_PATH=/app pnpm --filter @workspace/draftfly run build
RUN PORT=18150 BASE_PATH=/ pnpm --filter @workspace/landing run build

FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /srv
COPY --from=build /repo/artifacts/api-server/dist ./api
COPY --from=build /repo/artifacts/draftfly/dist/public ./static/app
COPY --from=build /repo/artifacts/landing/dist/public ./static/landing
ENV PORT=8080 \
    STATIC_APP_DIR=/srv/static/app \
    STATIC_LANDING_DIR=/srv/static/landing
EXPOSE 8080
# The image ships a `node` user. Nothing here needs root: the process reads
# these files and talks to Postgres, and never writes to its own filesystem.
# Running as root would hand a code-execution bug the whole container.
RUN chown -R node:node /srv
USER node
CMD ["node", "--enable-source-maps", "/srv/api/index.mjs"]
