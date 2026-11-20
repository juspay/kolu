import type { TerminalId } from "kolu-common/surface";
import { lifecycleCounters } from "../terminal/Terminal";
import { getTerminalRefs } from "../terminal/terminalRefs";
import { webglLifecycleSnapshot } from "../terminal/webglTracker";

interface KoluDebugApi {
  webgl: () => ReturnType<typeof webglLifecycleSnapshot>;
  bufferBytes: (
    id: TerminalId,
  ) => { primary: number; alternate: number } | null;
  atlas: (id: TerminalId) => { w: number; h: number } | null;
  lifecycle: () => {
    mounted: number;
    cleaned: number;
    stillMounted: number;
  };
}

export function installDebugHooks(): void {
  const api: KoluDebugApi = {
    webgl: () => webglLifecycleSnapshot(),
    bufferBytes: (id) => getTerminalRefs(id)?.probes.bufferBytes() ?? null,
    atlas: (id) => getTerminalRefs(id)?.probes.webglAtlas() ?? null,
    lifecycle: () => ({
      mounted: lifecycleCounters.mounts,
      cleaned: lifecycleCounters.cleanups,
      stillMounted: lifecycleCounters.mounts - lifecycleCounters.cleanups,
    }),
  };
  (window as unknown as { __kolu: KoluDebugApi }).__kolu = api;
  console.info(
    "[kolu] window.__kolu ready — webgl(), bufferBytes(id), atlas(id), lifecycle()",
  );
}
