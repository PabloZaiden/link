FROM oven/bun:1.3.13 AS build

WORKDIR /app

COPY package.json bun.lock bunfig.toml tsconfig.json bun-env.d.ts build.ts ./
COPY src ./src
RUN bun install --frozen-lockfile
RUN bun run build

FROM oven/bun:1.3.13

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV LINK_DATA_DIR=/data

COPY package.json bun.lock bunfig.toml tsconfig.json bun-env.d.ts build.ts ./
COPY --from=build /app/node_modules ./node_modules
COPY src ./src

EXPOSE 3000

CMD ["bun", "src/index.ts"]
