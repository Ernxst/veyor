import type { Machine, Task } from "@veyor/core";
import type { Command } from "effect/unstable/cli";

/**
 * An entry in `VeyorConfig.assemblies`: a ready factory, or — for
 * simulation-flavored assemblies — a factory parameterized by seed.
 * `veyor simulate` defaults to the config's sole seeded assembly.
 */
export type Assembly<M extends Machine.Any = Machine.Any> =
  | Machine.Impl<M>
  | ((seed: number) => Machine.Impl<M>);

type Assemblies<M extends Machine.Any = Machine.Any> = Readonly<Record<string, Assembly<M>>>;

/** The machine every assembly of an assemblies record implements. */
export type MachineOf<A extends Assemblies> = [A[keyof A]] extends [Assembly<infer M>]
  ? M
  : Machine.Any;

type PathsOf<T> = T extends readonly unknown[]
  ? never
  : T extends object
    ? { [K in keyof T & string]: K | `${K}.${PathsOf<T[K]>}` }[keyof T & string]
    : never;

/**
 * A dot path into the machine's context — object keys only, no array
 * traversal. Falls back to `string` when the context type is unknowable.
 */
export type ContextPath<Context> = [PathsOf<Context>] extends [never] ? string : PathsOf<Context>;

/** Sink names of the machine; plain `string` when the machine is unknowable. */
type SinksOf<M extends Machine.Any> = [Machine.Any] extends [M]
  ? string
  : Task.SinkNamesOf<M["tasks"]>;

interface ArgSpecBase<Context> {
  readonly key: ContextPath<Context>;
  readonly description?: string;
  /** The value on the command line is a path; its parsed contents land at `key`. */
  readonly from?: "file";
}

/**
 * One entry of the CLI surface a factory exposes. Purely presentational:
 * where the value lands (`key`), how it reads on the command line (a named
 * flag or a positional — never both), and its provenance (`from: "file"`
 * loads the value from the file the user names). Types come from the
 * context schema, never from here.
 */
export type ArgSpec<Context = unknown> =
  | (ArgSpecBase<Context> & {
      /** Flag name; defaults to the last segment of `key`. */
      readonly name?: string;
      readonly position?: never;
    })
  | (ArgSpecBase<Context> & {
      readonly name?: never;
      /** Makes this a positional argument, consumed in `position` order. */
      readonly position: number;
    });

export interface RunConfig<M extends Machine.Any = Machine.Any, A extends Assemblies = Assemblies> {
  /** Assembly used when `--assembly` is not passed. */
  readonly assembly?: keyof A & string;
  /** Sinks that exit 0; every other sink exits 1. Omit to treat all sinks as success. */
  readonly success?: SinksOf<M> | readonly SinksOf<M>[];
}

/**
 * The config as `defineConfig` checks it: assembly names, sink names, and
 * context paths are literal types read off the assemblies record.
 */
export interface TypedVeyorConfig<M extends Machine.Any, A extends Assemblies> {
  readonly name?: string;
  readonly description?: string;
  readonly version?: string;
  /** Rendered in `veyor run --help`; `{ command, description }` pairs. */
  readonly examples?: readonly Command.Command.Example[];
  readonly assemblies: A;
  readonly args?: readonly ArgSpec<Machine.ContextOf<M>>[];
  readonly run?: RunConfig<M, A>;
}

/** The config as the CLI consumes it: the typed view with literals erased. */
export interface VeyorConfig {
  readonly name?: string;
  readonly description?: string;
  readonly version?: string;
  readonly examples?: readonly Command.Command.Example[];
  readonly assemblies: Assemblies;
  readonly args?: readonly ArgSpec[];
  readonly run?: {
    readonly assembly?: string;
    readonly success?: string | readonly string[];
  };
}

export function defineConfig<const A extends Assemblies>(
  config: TypedVeyorConfig<MachineOf<A>, A>
): VeyorConfig {
  return config;
}

/** The machine definition every assembly of a config implements. */
export function blueprintOf(config: VeyorConfig): Machine.Any {
  const assembly = Object.values(config.assemblies).at(0);
  if (assembly === undefined) {
    throw new Error("veyor.config: declare at least one assembly.");
  }

  return (typeof assembly === "function" ? assembly(0) : assembly).def;
}

/**
 * The seeded assembly `veyor simulate` defaults to — defined only when
 * exactly one assembly is seed-parameterized.
 */
export function soleSeededName(config: VeyorConfig): string | undefined {
  const seeded = Object.entries(config.assemblies).filter(
    ([, assembly]) => typeof assembly === "function"
  );
  return seeded.length === 1 ? seeded[0]?.[0] : undefined;
}
