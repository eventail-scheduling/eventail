# Eventail

[![CI](https://github.com/eventail-scheduling/eventail/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/eventail-scheduling/eventail/actions/workflows/ci.yml?query=branch%3Amain)

A call for papers and scheduling system for conferences. The API and its background worker
live in `api/`, the web client in `web/`.

## Development

Requires Node.js 26, pnpm and Docker.

- `pnpm install`
- `docker compose up -d --wait`
- `pnpm --filter api mikro-orm migration:up`
- `pnpm --filter api mikro-orm seeder:run`
- `pnpm --filter api start`, and `pnpm --filter web start` in another terminal

The API listens on http://localhost:12001 and, outside production, serves its OpenAPI
reference at http://localhost:12001/openapi. The web client runs on http://localhost:12000;
`web/public/runtime-env.js` points it at the local API and the mock sign-in provider that
compose starts. Mail sent in development lands in Mailpit at http://localhost:12004.

## Tests

`pnpm typecheck` checks both packages. `pnpm test` runs both suites, so bring the API's
services up first:

- `docker compose up -d --wait postgres-test oidc s3`
- `docker compose run --rm s3-init`

The API's tests run on `node:test` against a tmpfs-backed Postgres instance (`postgres-test`
in compose.yml). The harness migrates a template database once per run; each test worker
clones it on demand. They log fatal errors only; `LOG_LEVEL=debug pnpm test` shows everything.

The web tests run under Vitest; the browser ones drive a headless Chrome, which has to be
installed on the machine.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Licensed under the [Apache License 2.0](LICENSE).
