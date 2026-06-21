FROM oven/bun:latest AS build

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY . .

FROM oven/bun:latest AS runtime

WORKDIR /app

COPY --from=build /app /app

EXPOSE 25

CMD ["bun", "run", "index.ts"]