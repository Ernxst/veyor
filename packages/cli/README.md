# `@forge/cli`

`@forge/cli` is the reserved command-line entry point for Forge.

> [!CAUTION]
> The workflow CLI is not implemented. This package is a private `0.0.0` scaffold and is not ready for users or package-registry installation.

## Current commands

The executable currently exposes two development fixtures:

```sh
forge foo <text> # prints uppercase text
forge bar <text> # prints reversed text
```

These commands test the Effect CLI wiring. They do not define, load, inspect, or run Forge workflows.

In particular, `forge run` does not exist yet. Any workspace script that calls it is a placeholder for the intended workflow runner.

## Intended role

The package will eventually host the process boundary for loading an assembled factory, starting it, reporting progress, and returning its final result. Those contracts must be implemented in `@forge/core` before this CLI can expose them honestly.

See [`@forge/core`](../core) for the current library API and the [Forge README](../../README.md) for project status.
