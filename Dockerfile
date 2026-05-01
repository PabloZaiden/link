FROM oven/bun:1.3.13 AS build

WORKDIR /app

COPY package.json bun.lock bunfig.toml tsconfig.json build.ts ./
COPY src ./src
RUN bun install --frozen-lockfile
RUN bun run build

FROM oven/bun:1.3.13

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV AUTH_MODE=none
ENV DATABASE_PROVIDER=sqlite
ENV SQLITE_PATH=/data/link.sqlite
ENV ADMIN_ENABLED=false

COPY package.json bun.lock bunfig.toml tsconfig.json build.ts ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY src ./src

RUN mkdir -p /data

EXPOSE 3000

CMD ["bun", "src/index.ts"]
