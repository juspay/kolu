/**
 * WHERE A PAGE REACHES SOLID'S DIAGNOSTICS CHANNEL — the one name both sides
 * of the dev-diagnostics lane agree on.
 *
 * `solid-js` exports `OBSERVE` in its development runtime only, and nothing in
 * a bundle hands it to a page script. So the client assigns it to this global
 * as it boots (`packages/client/src/solidDiagnosticsExpose.ts`, dev runtimes
 * only), and the e2e harness's init script owns the property beforehand so it
 * can subscribe the moment the client writes it
 * (`packages/tests/support/solidDevBuild.ts`).
 *
 * It lives here because it is a contract between two packages that both depend
 * on `kolu-common` and on nothing of each other's. This module imports
 * nothing: the client's copy is evaluated before any app module.
 */
export const SOLID_OBSERVE_GLOBAL = "__SOLID_OBSERVE__";

/** The fields of a Solid diagnostic {@link isSonnerToasterListMemo} reads,
 *  held loosely so the ONE predicate serves both lanes: the e2e harness's
 *  `PageDiagnostic` (a JSON round-trip of the event, every field `unknown`)
 *  and the unit setup's `DiagnosticEvent` (`code: string`, `nodeName?:
 *  string`, `ownerPath?: string[]`). Both carry these three under these
 *  names, so neither needs a predicate of its own. */
export interface SolidDiagnosticFields {
  code?: unknown;
  nodeName?: unknown;
  ownerPath?: unknown;
}

/** THE TOASTER'S OWN MEMOS, the one finding kolu allows a library to keep
 *  raising. `solid-sonner` 1.0.0 derives the toaster's lists — the visible
 *  toasts, and the per-position slices a `<For>` renders — with no `equals`
 *  option, so every toast republishes an equal-but-new array and Solid's dev
 *  build raises `UNSTABLE_MEMO_OUTPUT` on it. The repair is four `equals`
 *  options in the library's own source: wobsoriano/solid-sonner#56. THIS
 *  ALLOWANCE GOES the moment a `solid-sonner` release carries that fix —
 *  bump the dependency and delete this, with its tests and with the unit
 *  tripwire (`packages/client/src/toasterDiagnostics.test.tsx`) that fails
 *  when the warning stops coming.
 *
 *  The owner chain is what identifies them, not the code and not the file:
 *  the library's `dist/index.jsx` is where one of the two is attributed, but
 *  the other is attributed to the JSX call site that rendered the
 *  `<Toaster>`. Both are a memo named `computed` owned directly by
 *  `<Toaster>`, or by a `<For>` directly under it — so the tail of the chain
 *  is the identity, and a memo of kolu's own under the same code, or another
 *  code under the same toaster, is untouched by this. */
export const TOASTER_MEMO_OWNER_TAILS: readonly (readonly string[])[] = [
  ["<Toaster>", "computed"],
  ["<Toaster>", "<For>", "computed"],
];

/** Is this finding one of {@link TOASTER_MEMO_OWNER_TAILS}? All three of the
 *  code, the node name and the owner tail must match, so this names the
 *  library's lists and nothing else. */
export function isSonnerToasterListMemo(event: SolidDiagnosticFields): boolean {
  if (event.code !== "UNSTABLE_MEMO_OUTPUT") return false;
  if (event.nodeName !== "computed") return false;
  const path = event.ownerPath;
  if (!Array.isArray(path)) return false;
  return TOASTER_MEMO_OWNER_TAILS.some(
    (tail) =>
      path.length >= tail.length &&
      tail.every((owner, i) => path[path.length - tail.length + i] === owner),
  );
}
