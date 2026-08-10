import type * as Schema from "./schema.ts";

/** Items whose review floor is the deterministic quality gate. */
export function gateTier(item: Schema.Item): boolean {
  return item.complexity === "trivial" && item.risk === "low";
}

/** Pending items whose dependencies are all integrated — workable right now. */
export function readyItems(backlog: readonly Schema.Item[]): Schema.Item[] {
  const integrated = new Set(
    backlog.filter((item) => item.status === "integrated").map((item) => item.id)
  );
  return backlog.filter(
    (item) => item.status === "pending" && item.dependsOn.every((dep) => integrated.has(dep))
  );
}

/**
 * Pending items that can never become ready: something in their transitive
 * dependencies is deferred or missing. Deferral cascades — a parked item
 * parks its dependents — which is what lets a partial delivery terminate
 * instead of waiting forever on unreachable work.
 */
export function unreachableItems(backlog: readonly Schema.Item[]): Set<string> {
  const byId = new Map(backlog.map((item) => [item.id, item]));
  const blocked = new Set<string>();

  const isBlocked = (id: string, trail: Set<string>): boolean => {
    const item = byId.get(id);
    if (item === undefined || item.status === "deferred") return true;
    if (item.status === "integrated") return false;
    if (blocked.has(id)) return true;
    if (trail.has(id)) return false; // cycles are inconsistency, not deferral
    trail.add(id);
    return item.dependsOn.some((dep) => isBlocked(dep, trail));
  };

  for (const item of backlog) {
    if (item.status === "pending" && isBlocked(item.id, new Set())) blocked.add(item.id);
  }

  return blocked;
}
