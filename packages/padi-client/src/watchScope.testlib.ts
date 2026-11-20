import { type WatchScope, watchScopeOf } from "./watchScope.ts";

/** Build a scope, or throw the refusal's own message. */
export const scopeOf = (
  opts: Parameters<typeof watchScopeOf>[0],
): WatchScope => {
  const scope = watchScopeOf(opts);
  if (scope.kind === "error") throw new Error(scope.message);
  return scope.value;
};
