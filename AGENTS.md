# Repository Guidelines

## Project Structure & Module Organization

- `cmd/lumi/` starts the Go server; `internal/app/` contains HTTP handlers, generation, OAuth, voice processing, SQLite persistence, and numbered SQL migrations.
- `web/src/` contains the React/TypeScript UI and component tests; `web/public/` holds PWA assets. Browser tests and fixtures live in `web/e2e/`.
- `api/openapi.json` is the API source of truth. Generated code lives in `internal/api/` and `web/src/api/`.
- `docs/` covers deployment and pedagogical evaluation. Build outputs are `dist/lumi` and `web/dist/`.

## Build, Test, and Development Commands

Use the versions pinned in `mise.toml` and the pnpm lockfile.

- `just setup`: install tools and dependencies; initialize `.env.local` only if absent.
- `just dev`: run Go and Vite through mprocs; open `http://127.0.0.1:15173`. Restart the API after Go changes.
- `just api` / `just ui`: run services separately.
- `just generate`: regenerate Go and TypeScript interfaces after API changes.
- `just check`: check generated code, Go static analysis, TypeScript types, and backend/frontend tests.
- `just browser-install`: install Chromium for browser tests.
- `just test-e2e`: build the frontend and run desktop/Android Playwright tests.
- `just build`: build the server and production frontend.

## Coding Style & Naming Conventions

Format Go with `gofmt`; use `go vet` via `just lint`. Follow existing TypeScript style: two-space indentation, single quotes, semicolons, strict types, and PascalCase component filenames. Use descriptive camelCase functions and variables. Add migrations as `NNN_description.sql`; preserve existing migrations. Regenerate API code instead of editing generated files. Keep child-facing copy in simple Italian and interfaces visually quiet.

## Testing Guidelines

Go tests use `*_test.go`; Vitest and Testing Library use colocated `*.test.ts` or `*.test.tsx`; Playwright uses `web/e2e/*.spec.ts`. Run focused checks with `just test-be` or `just test-fe`. Cover changed behavior, streaming failures, persistence, and mobile layout as relevant. No numeric coverage threshold is configured. Keep live-model tests opt-in through `LUMI_LIVE_TEST_DATA_DIR`; they consume the configured plan.

## Commit & Pull Request Guidelines

This checkout has no Git metadata, so historical commit conventions cannot be verified. Use concise imperative subjects describing the change. PRs should explain the problem, resulting behavior, and validation; link relevant issues, include screenshots for UI changes, and document migrations or deployment implications.

## Security & Configuration

Use `.env.local` for development and `.env` for production. Never commit credentials, database files, or `data/`. Deployment uses Docker Compose behind the existing host Caddy service. Consult `docs/deployment.md`. Keycloak administration is reachable only through VPS loopback and SSH forwarding.
