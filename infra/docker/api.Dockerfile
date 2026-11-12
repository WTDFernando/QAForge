# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@qaforge/api...
RUN pnpm deploy --filter=@qaforge/api --prod --legacy /out \
 && cp -r apps/api/dist /out/dist \
 && cp -r packages/db/prisma /out/prisma

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out .
EXPOSE 4000
USER node
# Run migrations as a separate release step: `pnpm db:deploy`
CMD ["node", "dist/main.js"]
