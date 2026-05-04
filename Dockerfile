FROM oven/bun:1.3.13 AS build

WORKDIR /app

COPY package.json bun.lock bunfig.toml tsconfig.json bun-env.d.ts build.ts build-binary.ts ./
COPY src ./src
RUN bun install --frozen-lockfile
RUN bun run build
RUN bun run build:binary

FROM debian:bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV LINK_DATA_DIR=/data

COPY --from=build /app/dist/link-cli /usr/local/bin/link-cli

EXPOSE 3000

CMD ["link-cli", "web"]
