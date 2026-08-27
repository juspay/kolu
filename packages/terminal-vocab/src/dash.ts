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
 *  `./agentProjection` re-exports it, because that is the door every consumer
 *  already knows — the same arrangement `kolu-common/config` has with
 *  `./defaultPort`. */
export const DASH = "—";
