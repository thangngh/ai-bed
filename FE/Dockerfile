# Matches the BE image and Vite 6's supported range (20.19+ / 22.12+).
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# nginx-unprivileged rather than nginx: same nginx, same conf.d drop-in, but
# it runs as uid 101 with no root master process. The stock image runs its
# master as root, which the OWASP review flagged (A05) -- and this is the one
# container with a published port, so it is the one where it matters most.
# The trade is that it cannot bind port 80; the server block listens on 8080
# and compose still publishes 80 on the host.
FROM nginxinc/nginx-unprivileged:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]