/** Render a terminal screen as a picture.
 *
 *  A leaf, in the `terminal-themes` / `@kolu/terminal-protocol` tier: it
 *  hides a bounded algorithm (grid + theme → drawing instructions), not a
 *  volatility, so it is a plain workspace package rather than a `@kolu/*`
 *  receptacle.
 *
 *  The root entry is pure and browser-safe. The PNG rasteriser — wasm and
 *  font files — lives behind `terminal-snapshot/png`, which only the daemon
 *  imports. */

export {
  DEFAULT_COLOR,
  type CellColor,
  type ReadableBuffer,
  type ReadableCell,
  readGrid,
  type SnapshotCell,
  type SnapshotGrid,
  type SnapshotRow,
} from "./cell.ts";
export {
  buildScene,
  CHROME,
  type ResolvedTheme,
  resolveTheme,
  type SceneDot,
  type SceneGlyph,
  type SceneInput,
  type SceneRect,
  type SnapshotScene,
} from "./scene.ts";
export { sceneToSvg } from "./svg.ts";
