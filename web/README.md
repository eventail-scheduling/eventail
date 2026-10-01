# Eventail Web

[![CI](https://github.com/eventail-scheduling/eventail-web/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/eventail-scheduling/eventail-web/actions/workflows/ci.yml?query=branch%3Amain)

The web client for Eventail, a call for papers and scheduling system for conferences. It talks
to the [Eventail API](https://github.com/eventail-scheduling/eventail-api).

## Development

Requires Node.js 26 and pnpm, and a running API; its README covers the setup.

- `pnpm install`
- `pnpm start`

The app runs on http://localhost:12000. `public/runtime-env.js` points it at the local API and
the mock sign-in provider the API's compose file starts.

## Tests

`pnpm typecheck` checks the types of the app and the tests. `pnpm test` runs the unit tests and
the browser tests; the browser tests drive the Google Chrome installed on the machine, headless.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Licensed under the [Apache License 2.0](LICENSE).
