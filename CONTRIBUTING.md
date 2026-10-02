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
  `locations`, `openapi`, `schedules`, `session-types`, `sessions`, `teams`, `tracks`, `ui`,
  `users`, `deps`, `deps-dev`. Leave it out when a change spans several areas. `deps` and
  `deps-dev` are for dependency updates.
- **Body:** lines of at most 100 characters. Say why the change is made; the diff shows what
  changed.

## Pull requests

Run `pnpm typecheck` and `pnpm test` before opening one; the test services are listed in the
README.

## Releases

Versions and `CHANGELOG.md` come from the commit messages on `main`: release-please keeps a
release pull request open, and merging it tags the release and publishes both container
images.
Leave the version and the changelog to it.

## The contract version

`api/src/util/contract-version.ts` holds an integer that every API response carries in an
`Eventail-Contract-Version` header, so a client can tell whether it still understands the
server. Unlike the release version, nothing raises it for you.

Raise it by one when a change breaks a client written against the previous number. What counts
differs by direction.

In a response: an endpoint or a field renamed, a field a client could rely on no longer being
sent, a set a client branches on gaining a member, such as a new status or a new error code.
Dropping a field that was already allowed to be absent does not count, because a correct client
handles its absence already, and nor does narrowing a value, which only removes cases a reader
had to handle.

In a request it is the other way, and stricter. Every attributes schema is a `z.strictObject`,
so an unknown member is refused with a 422: renaming or removing any accepted field breaks a
client that still sends it, whether or not the field was optional. Narrowing what a field
accepts, and making an optional field required, break it too.

A change that breaks a correct client without touching any field counts as well: a permission
tightened so a caller who could read something now cannot, a default changed, a status that
used to come back no longer coming back.

Raise it in the same commit as the change. A build between the two would serve the break at the
old number, which is the one thing the number exists to prevent.

Adding something a client can ignore leaves the number alone.

It covers the whole HTTP surface rather than only what an integration token reaches, because a
third-party client signs in as a user and reads the same endpoints the web app does.

## License

Contributions are licensed under the [Apache License 2.0](LICENSE), the same as the project, as
its section 5 sets out.
