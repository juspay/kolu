/** The bundled xterm.js version, sourced from the package this repo actually
 *  resolves. Lives here because `@kolu/solid-xterm` owns the `@xterm/*`
 *  dependency — consumers (e.g. the client's Diagnostic Info dump) read it from
 *  the package rather than re-deriving it via a build-time define, which would
 *  reintroduce a direct `@xterm/xterm` dependency in the consumer. */

import xtermPackage from "@xterm/xterm/package.json" with { type: "json" };

export const XTERM_VERSION: string = xtermPackage.version;
