/** Dev-only `window.__kolu` hook — gives heap/retainer investigations a
 *  one-line path to live counts of xterm instances, SolidJS reactive nodes,
 *  and the same snapshot DiagnosticInfo copies to clipboard. Installed from
 *  `index.tsx` only when `import.meta.env.DEV` is true so it can't leak into
 *  production bundles.
 *
 *  Usage examples (paste in DevTools console):
 *
 *    __kolu.webgl()                    // { totalCreated, aliveDetached, ... }
 *    __kolu.bufferBytes("d50a1349-…")  // { primary, alternate }
 *    __kolu.terminalCount()            // live xterm Terminal instances (best-effort)
 *    __kolu.signalCount()              // SolidJS signal count (best-effort)
 *
 *  Counts rely on the `terminalRefs` Map + webglTracker; they do not walk
 *  the reactive graph. For retainer-chain analysis use a Chrome heap
 *  snapshot + `docs/perf-investigations/scripts/` analyzers. */

import { webglLifecycleSnapshot } from "../terminal/webglTracker";
import { getTerminalRefs } from "../terminal/terminalRefs";
import { lifecycleCounters } from "../terminal/Terminal";
import type { TerminalId } from "kolu-common";

interface KoluDebugApi {
  webgl: () => ReturnType<typeof webglLifecycleSnapshot>;
  bufferBytes: (
    id: TerminalId,
  ) => { primary: number; alternate: number } | null;
  atlas: (id: TerminalId) => { w: number; h: number } | null;
  /** Terminal.tsx mount / onCleanup counters — #606 disposal audit. If
   *  `mounts - cleanups` > live component count, some Terminal
   *  components never run cleanup on unmount (the leak path). */
  lifecycle: () => { mounts: number; cleanups: number };
}

export function installDebugHooks(): void {
  const api: KoluDebugApi = {
    webgl: () => webglLifecycleSnapshot(),
    bufferBytes: (id) => getTerminalRefs(id)?.probes.bufferBytes() ?? null,
    atlas: (id) => getTerminalRefs(id)?.probes.webglAtlas() ?? null,
    lifecycle: () => ({ ...lifecycleCounters }),
  };
  (window as unknown as { __kolu: KoluDebugApi }).__kolu = api;
  console.info(
    "[kolu] window.__kolu ready — webgl(), bufferBytes(id), atlas(id), lifecycle()",
  );
}
