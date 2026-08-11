import { pathToFileURL } from "node:url";
import { Effect, FileSystem } from "effect";
import * as Schema from "effect/Schema";
import type { ForgeConfig } from "./config.ts";

export class ConfigError extends Schema.TaggedErrorClass<ConfigError>("ConfigError")(
  "ConfigError",
  { message: Schema.String }
) {}

const CANDIDATES = ["forge.config.ts", "forge.config.js"];

/**
 * Loads `forge.config.{ts,js}` from the working directory; resolves to
 * `undefined` when there is none. Boundary adapter: the config is user
 * TypeScript, imported by the host runtime (Bun).
 */
export const loadConfig: Effect.Effect<
  ForgeConfig | undefined,
  ConfigError,
  FileSystem.FileSystem
> = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  const file = yield* findConfigFile(fs);
  if (file === undefined) return undefined;

  const module = yield* Effect.tryPromise({
    try: (): Promise<unknown> => import(pathToFileURL(file).href),
    catch: (cause) =>
      new ConfigError({
        message: `${file}: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });

  return yield* assertConfig(module, file);
});

function findConfigFile(fs: FileSystem.FileSystem): Effect.Effect<string | undefined> {
  return Effect.gen(function* () {
    for (const candidate of CANDIDATES) {
      const exists = yield* fs.exists(candidate).pipe(Effect.orElseSucceed(() => false));
      if (exists) return candidate;
    }

    return undefined;
  });
}

function assertConfig(module: unknown, file: string): Effect.Effect<ForgeConfig, ConfigError> {
  const config = defaultExportOf(module);

  if (!isConfigShaped(config)) {
    return Effect.fail(
      new ConfigError({ message: `${file} must default-export defineConfig({ assemblies, ... }).` })
    );
  }

  if (Object.keys(config.assemblies).length === 0) {
    return Effect.fail(new ConfigError({ message: `${file} declares no assemblies.` }));
  }

  return Effect.succeed(config);
}

function defaultExportOf(module: unknown): unknown {
  if (typeof module !== "object" || module === null) return undefined;
  return "default" in module ? module.default : undefined;
}

function isConfigShaped(config: unknown): config is ForgeConfig {
  if (typeof config !== "object" || config === null) return false;
  return "assemblies" in config;
}
