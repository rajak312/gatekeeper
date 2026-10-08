# syntax=docker/dockerfile:1
# Build from the monorepo root:  docker build -f apps/web/Dockerfile --build-arg API_INTERNAL_URL=http://api:4500 .

FROM node:24-slim AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --workspace @gatekeeper/web --workspace @gatekeeper/shared --include-workspace-root --no-audit --no-fund

FROM deps AS build
# Rewrites to the API are compiled into the build output, so the URL is a build arg.
ARG API_INTERNAL_URL=http://api:4500
ENV API_INTERNAL_URL=$API_INTERNAL_URL NEXT_OUTPUT=standalone NEXT_TELEMETRY_DISABLED=1
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @gatekeeper/shared && npm run build -w @gatekeeper/web

FROM base AS runtime
ENV NODE_ENV=production PORT=3500 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static apps/web/.next/static
COPY --from=build /app/apps/web/public apps/web/public
USER node
EXPOSE 3500
CMD ["node", "apps/web/server.js"]
