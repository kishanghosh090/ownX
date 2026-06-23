FROM oven/bun:alpine

WORKDIR /app


COPY package.json .
COPY tsconfig.json .

RUN bun install 

COPY . .
EXPOSE 80
EXPOSE 8080
CMD [ "bun", "run", "dev" ]