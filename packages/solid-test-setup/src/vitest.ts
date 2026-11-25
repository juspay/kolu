/**
 * Which specifiers Solid ships itself under — the one list every Solid DOM
 * test project inlines.
 *
 * Vitest must pull Solid THROUGH its own transform: an externalized copy loads
 * its OWN reactive core, whose graph never shares the test's, so a store update
 * never re-runs an observing effect or memo. Missing an entry fails silently
 * that way, which is why the list lives here rather than in each config.
 */
export const SOLID_INLINE_DEPS: readonly RegExp[] = [/solid-js/, /@solidjs\//];

/**
 * The same list plus `@solid-primitives/scheduled`, whose `debounce` no-ops on
 * the server build — the surface projects' coalescing tests need the browser
 * one.
 */
export const SOLID_INLINE_DEPS_SCHEDULED: readonly (RegExp | string)[] = [
  ...SOLID_INLINE_DEPS,
  "@solid-primitives/scheduled",
];
