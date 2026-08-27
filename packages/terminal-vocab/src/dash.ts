/** **The em-dash sentinel** — "no value / never observed", spelled once so every
 *  renderer and every direct read shares the one glyph.
 *
 *  It sits in its own module, importing nothing, because BOTH of this package's
 *  renderers need it and neither owns it. `./agentProjection` returns it for a
 *  terminal that is in no git repo, has no agent, or has no PR check — none of
 *  which is a duration; `./duration` returns it for a delta that cannot be
 *  trusted. Defining it in either one and reading it from the other is the
 *  import cycle this file exists to have never had.
 *
 *  It is an export entry of its own (`@kolu/terminal-vocab/dash`), because a
 *  module written to import nothing is not a leaf if the only way to reach it is
 *  through a 503-line projection that runtime-imports `./duration` and
 *  type-imports `./schema` — and therefore `effect`. `./agentProjection`
 *  re-exports it as the SECOND door, the one every consumer already knows: the
 *  same arrangement `kolu-common/config` has with `./defaultPort`, which is a
 *  second door and not the only one. */
export const DASH = "—";
