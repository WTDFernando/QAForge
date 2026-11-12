# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
ENV NEXT_TELEMETRY_DISABLED=1
# API_URL is read when rewrites are built; override at build time for other targets.
ARG API_URL=http://api:4000
ENV API_URL=$API_URL
RUN pnpm turbo run build --filter=@qaforge/web...

FROM base AS runtime
WORKDIR /repo
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /repo .
EXPOSE 3000
USER node
CMD ["pnpm", "--filter", "@qaforge/web", "start"]
