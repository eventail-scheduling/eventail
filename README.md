# Eventail API

[![CI](https://github.com/eventail-scheduling/eventail-api/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/eventail-scheduling/eventail-api/actions/workflows/ci.yml?query=branch%3Amain)

The API behind Eventail, a call for papers and scheduling system for conferences. The web
client lives in [eventail-web](https://github.com/eventail-scheduling/eventail-web).

## Development

Requires Node.js 26, pnpm and Docker.

- `pnpm install`
- `docker compose up -d`
- `pnpm mikro-orm migration:up`
- `pnpm mikro-orm seeder:run`
- `pnpm start`

The API listens on http://localhost:12001 and, outside production, serves its OpenAPI
reference at http://localhost:12001/openapi. Mail sent in development lands in Mailpit at
http://localhost:12004.

## Tests

Tests run on `node:test` against a tmpfs-backed Postgres instance
(`postgres-test` in compose.yml). The harness migrates a template
database once per run; each test worker clones it on demand.

- `docker compose up -d postgres-test oidc s3 s3-init`
- `pnpm test`

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Licensed under the [Apache License 2.0](LICENSE).
