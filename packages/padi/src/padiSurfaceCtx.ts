import type { padiSurface } from "@kolu/padi-client/surface";
import { createLateBoundSurfaceCtx } from "./lateBoundSurfaceCtx.ts";

export const {
  proxy: padiSurfaceCtx,
  set: setPadiSurfaceCtx,
  resetForTest: __resetPadiSurfaceCtxForTest,
  noopForTest: noopPadiSurfaceCtxForTest,
} = createLateBoundSurfaceCtx<(typeof padiSurface)["spec"]>("padi");
