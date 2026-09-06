# 22, not 20: undici 8 declares `engines: node >=22.19.0` and on Node 20 it
# throws `webidl.util.markAsUncloneable is not a function` the moment
# engine-gateway.service requires it -- the container crash-looped before
# serving a single request.
FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/dist ./dist/
COPY --from=build /app/node_modules ./node_modules/
COPY --from=build /app/package.json ./

# Non-root, using the `node` user the base image already ships.
RUN chown -R node:node /app
USER node

EXPOSE 3001
# Schema comes from the TypeORM migrations the app runs itself on boot
# (`migrationsRun: true` in app.module.ts), so there is no separate
# schema-initializer step and no writable data directory.
CMD ["node", "dist/main"]
