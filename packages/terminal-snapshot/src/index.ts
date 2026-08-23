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

/*  What leaves this package is what a consumer outside it actually reads —
 *  the wire vocabulary kaval and padi mirror, the two entry points, and the
 *  scene the backends execute. The palette resolver, the row-height ratio and
 *  the individual drawing-instruction shapes are the layout's own working
 *  parts: re-exporting them advertised a surface no caller ever asked for, and
 *  every name in a barrel is a name someone can start depending on. */
export {
  type CellColor,
  type ReadableBuffer,
  readGrid,
  type SnapshotCell,
  type SnapshotGrid,
  type SnapshotRow,
} from "./cell.ts";
export {
  buildScene,
  cellHeight,
  CHROME,
  type SceneGlyph,
  type SceneInput,
  type SnapshotScene,
} from "./scene.ts";
export { sceneToSvg } from "./svg.ts";
