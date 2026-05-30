/** `@kolu/platform` — framework-agnostic adapters over browser/OS platform
 *  quirks: keyboard-event chord matching (`keyboard`), Apple-vs-rest modifier
 *  detection (`os`), and clipboard writes that survive non-secure contexts
 *  (`clipboard`). No `solid-js` dependency — hence no `solid-` prefix. */

export * from "./clipboard";
export * from "./keyboard";
export * from "./os";
