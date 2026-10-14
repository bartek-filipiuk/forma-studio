FROM node:22-bookworm-slim AS build
WORKDIR /app/apps/web
COPY apps/web/package*.json ./
RUN npm ci
COPY apps/web/ ./
COPY packages/ /app/packages/
COPY samples/pico.forma.json /app/samples/pico.forma.json
RUN npm run build
FROM caddy:2.10-alpine
COPY --from=build /app/apps/web/dist /srv
COPY infra/Caddyfile /etc/caddy/Caddyfile
EXPOSE 80
