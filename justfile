# Preserve spaces and literal shell characters in forwarded arguments.
set positional-arguments

# List available recipes.
default:
    @just --list

# Install tools and dependencies; prepare only the local configuration.
[group('setup')]
setup:
    mise install
    mise exec -- pnpm install --frozen-lockfile
    mise exec -- go mod download
    @just _local-env

[private]
_local-env:
    @if [ ! -e .env.local ]; then cp .env.local.example .env.local; fi

# Install Chromium for browser tests (on Linux, add --with-deps if needed).
[group('setup')]
browser-install *args:
    mise exec -- pnpm --dir web exec playwright install chromium "$@"

# Manage Go and Vite together in mprocs.
[group('development')]
dev: _local-env
    mise exec -- mprocs --config mprocs.yaml

# Run the API alone using .env.local.
[group('development')]
api: _local-env
    @just --dotenv-path .env.local _api

[private]
_api:
    PUBLIC_ORIGIN="${PUBLIC_ORIGIN:-http://localhost:${LUMI_DEV_UI_PORT:-15173}}" LISTEN_ADDR="127.0.0.1:${LUMI_DEV_API_PORT:-18080}" DATA_DIR="${DATA_DIR:-data/local}" mise exec -- go run ./cmd/lumi

# Run Vite alone; uses the same development ports as the API recipe.
[group('development')]
ui *args: _local-env
    @just --dotenv-path .env.local _ui "$@"

[private]
_ui *args:
    LUMI_DEV_API_PORT="${LUMI_DEV_API_PORT:-18080}" mise exec -- pnpm dev --host localhost --port "${LUMI_DEV_UI_PORT:-15173}" --strictPort "$@"

# Regenerate Go and TypeScript clients from the OpenAPI contract.
[group('development')]
generate:
    mise exec -- pnpm generate

[group('development')]
check-generated:
    mise exec -- sh scripts/check-generated.sh

[group('development')]
lint:
    mise exec -- go vet ./...

[group('development')]
typecheck:
    mise exec -- pnpm typecheck

# Run backend and frontend unit/integration tests.
[group('development')]
test: test-be test-fe

[group('development')]
test-be *args:
    mise exec -- go test -race "$@" ./...

[group('development')]
test-fe *args:
    mise exec -- pnpm test "$@"

# Build the frontend, then run desktop and Android browser tests.
[group('development')]
test-e2e *args: build-fe
    mise exec -- pnpm test:e2e "$@"

# Check generated code, static analysis, types, and tests.
[group('development')]
check: check-generated lint typecheck test test-deploy

[group('development')]
test-deploy:
    python3 -m unittest discover -s scripts/tests -v
    bash -n scripts/deploy-remote.sh

# Opt-in real Docker test; removes only its randomly named disposable resources.
[group('development')]
test-deploy-compose *args:
    python3 scripts/test-deploy-compose.py "$@"

# Opt-in Watchtower smoke test with a disposable local registry and app.
[group('development')]
test-watchtower:
    python3 scripts/test-watchtower-compose.py

# Open the existing SSH host alias.
[group('deployment')]
ssh:
    ssh lumi-server

# Forward Keycloak admin to http://localhost:19090/keycloak/admin/.
[group('deployment')]
ssh-keycloak-admin:
    ssh -N -L 19090:127.0.0.1:19090 lumi-server

# Print the server's Keycloak admin username/password; sudo may prompt.
[group('deployment')]
ssh-keycloak-admin-credentials:
    ssh -t lumi-server 'sudo grep -E "^(KEYCLOAK_ADMIN_USER|KEYCLOAK_ADMIN_PASSWORD)=" /home/serviceman/lumi/config/.env'

# Prepare serviceman's private deployment directories and verify Docker.
[group('deployment')]
deploy-setup:
    python3 scripts/deploy.py --setup

# Deploy the latest publication, check it, select a run, or roll back a release.
[group('deployment')]
deploy *args:
    python3 scripts/deploy.py "$@"

# Build the Go binary into dist/ and the frontend into web/dist/.
[group('development')]
build: build-be build-fe

[group('development')]
build-be:
    mkdir -p dist
    mise exec -- go build -trimpath -o dist/lumi ./cmd/lumi

[group('development')]
build-fe:
    mise exec -- pnpm build

# Build the full deployment stack.
[group('docker')]
docker-prod-build:
    docker compose --env-file .env -f compose.yaml -f compose.prod.yaml -f compose.build.yaml build

# Start the full stack using PUBLIC_ORIGIN and ports from .env.
[group('docker')]
docker-prod-up:
    docker compose --env-file .env -f compose.yaml -f compose.prod.yaml -f compose.build.yaml up -d --build

# Stop the full stack; retain conversations and credentials.
[group('docker')]
docker-prod-down:
    docker compose --env-file .env -f compose.yaml -f compose.prod.yaml -f compose.build.yaml stop

[group('docker')]
docker-prod-status:
    docker compose --env-file .env -f compose.yaml -f compose.prod.yaml -f compose.build.yaml ps

[group('docker')]
docker-prod-logs *args:
    docker compose --env-file .env -f compose.yaml -f compose.prod.yaml -f compose.build.yaml logs "$@"

# Generate private, isolated settings for local development services.
[group('docker')]
local-setup:
    python3 scripts/local-stack.py

[group('docker')]
local-up: local-setup
    docker compose --env-file .env.stack.local -f compose.yaml -f compose.local.yaml up -d --wait --remove-orphans

[group('docker')]
local-down:
    docker compose --env-file .env.stack.local -f compose.yaml -f compose.local.yaml stop

[group('docker')]
local-status:
    docker compose --env-file .env.stack.local -f compose.yaml -f compose.local.yaml ps

[group('docker')]
local-logs *args:
    docker compose --env-file .env.stack.local -f compose.yaml -f compose.local.yaml logs "$@"

# Tests real local Keycloak sessions without calling Google or OpenAI.
[group('development')]
test-auth: build
    mise exec -- pnpm --dir web exec playwright test --config playwright.auth.config.ts
