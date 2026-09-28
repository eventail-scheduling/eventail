# Contributing

## Setup

`pnpm install` also installs the Git hooks. Before each commit, Biome checks and formats the
staged code and JSON files; each commit message is checked against the conventions below. Pull
requests get the same check on their title and every commit.

## Commit messages

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):
`type(scope): subject`, for example `fix(sessions): keep the stored track after a refresh`.

- **Type:** `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`,
  `style` or `test`.
- **Scope:** optional, and one of `auth`, `custom-fields`, `editions`, `invites`, `jobs`,
  `locations`, `openapi`, `schedules`, `session-types`, `sessions`, `teams`, `tracks`, `users`,
  `webhooks`, `deps`, `deps-dev`. Leave it out when a change spans several areas. `deps` and
  `deps-dev` are for dependency updates.
- **Body:** lines of at most 100 characters. Say why the change is made; the diff shows what
  changed.

## Pull requests

Run `pnpm typecheck` and `pnpm test` before opening one; the test services are listed in the
README.

## Releases

Versions and `CHANGELOG.md` come from the commit messages on `main`: release-please keeps a
release pull request open, and merging it tags the release and publishes the container image.
Leave the version and the changelog to it.

## License

Contributions are licensed under the [Apache License 2.0](LICENSE), the same as the project, as
its section 5 sets out.
