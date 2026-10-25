FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ENV NITRO_PRESET=node-server
RUN npm run build

FROM node:22-bookworm-slim AS run

WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
ENV NITRO_HOST=0.0.0.0
ENV NITRO_PORT=8080

COPY --from=build /app/.output ./.output
COPY --from=build /app/node_modules/@electric-sql/pglite/dist/pglite.data ./.output/server/_libs/pglite.data
COPY --from=build /app/node_modules/@electric-sql/pglite/dist/pglite.wasm ./.output/server/_libs/pglite.wasm
COPY --from=build /app/node_modules/@electric-sql/pglite/dist/initdb.wasm ./.output/server/_libs/initdb.wasm

EXPOSE 8080

CMD ["node", ".output/server/index.mjs"]
