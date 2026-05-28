/** `@kolu/solid-xterm` — Solid-native adapter for xterm.js.
 *
 *  One coherent primitive: `createSolidXterm({ theme, fontSize,
 *  addons, webgl, scrollLock, onTerm }) → SolidXtermHandle`. It
 *  takes the place of `new XTerm(...)` and owns construction,
 *  addon attachment, reactive theme + fontSize sync, WebGL
 *  lifecycle policy, and scroll-lock as integrated submodules.
 *
 *  See `./createSolidXterm.ts` for the API and the module
 *  docstring on reactive ownership. See `./README.md` for usage.
 *
 *  The lifecycle submodules (`./internal/webgl`,
 *  `./internal/styleSync`, `./internal/scrollLock`) are intentionally
 *  not re-exported — they are the package's implementation, not its
 *  surface. A package that ships them as parallel public entries
 *  would be partial wiring, not a socket. */

export {
  createSolidXterm,
  type SolidXtermAddonOptions,
  type SolidXtermHandle,
  type SolidXtermOptions,
  type SolidXtermWebglOptions,
} from "./createSolidXterm";
