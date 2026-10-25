FROM node:24-bookworm-slim AS frontend
WORKDIR /src
RUN corepack enable && corepack prepare pnpm@12.8.2 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json web/package.json
RUN pnpm install --frozen-lockfile
COPY web/ web/
RUN NODE_OPTIONS=--max-old-space-size=768 pnpm build

FROM golang:1.26.9-bookworm AS backend
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ cmd/
COPY internal/ internal/
RUN CGO_ENABLED=0 GOMAXPROCS=2 go build -p 2 -trimpath -ldflags="-s -w" -o /lumi ./cmd/lumi

FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates ffmpeg curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 lumi && useradd --uid 10001 --gid lumi --no-create-home lumi \
    && mkdir /data && chown lumi:lumi /data
WORKDIR /app
COPY --from=backend /lumi /usr/local/bin/lumi
COPY --from=frontend --chown=10001:10001 /src/web/dist /app/web
# Deployment configuration travels with the exact application image it describes.
COPY compose.yaml compose.prod.yaml .env.example /opt/lumi-deploy/
COPY deploy/keycloak/ /opt/lumi-deploy/deploy/keycloak/
ENV DATA_DIR=/data WEB_DIR=/app/web LISTEN_ADDR=:8080
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD curl --fail --silent http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["/usr/local/bin/lumi"]
