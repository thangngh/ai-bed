# 22, not 20: undici 8 declares `engines: node >=22.19.0` and on Node 20 it
# throws `webidl.util.markAsUncloneable is not a function` the moment
# engine-gateway.service requires it -- the container crash-looped before
# serving a single request.
FROM node:22-alpine AS build
WORKDIR /app

# sqlite3 is a native module and publishes no musl prebuild, so `npm ci` falls
# back to compiling it. Without a toolchain the install fails; the build deps
# are dropped again in the same layer so they never reach the final image.
RUN apk add --no-cache --virtual .build-deps python3 make g++

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build \
    && npm prune --omit=dev \
    && apk del .build-deps

FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/dist ./dist/
COPY --from=build /app/node_modules ./node_modules/
COPY --from=build /app/package.json ./
COPY --from=build /app/scripts/create-all-tables.js ./scripts/create-all-tables.js

# The SQLite files are created on first boot inside the `be-data` volume that
# compose mounts here. Copying the host's data/ would bake a developer's
# tenants and stories into the image.
RUN mkdir -p data

# Non-root, using the `node` user the base image already ships. `data/` has to
# be chowned before the drop: it is the mount point for the be-data volume, and
# Docker gives a fresh named volume the ownership of the directory it covers --
# so getting this wrong means SQLite cannot create its files and the BE
# crash-loops on first boot with EACCES.
RUN chown -R node:node /app
USER node

EXPOSE 3001
# Production deliberately keeps TypeORM synchronize off. Run the idempotent
# schema initializer before Nest so a fresh volume has every business table;
# CREATE TABLE IF NOT EXISTS preserves existing data, including admin_users.
CMD ["sh", "-c", "node scripts/create-all-tables.js && exec node dist/main"]
