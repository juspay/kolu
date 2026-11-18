/**
 * How a directory is SPELLED, decided once.
 *
 * A served directory arrives from more than one hand and none of them agree
 * about a trailing slash: a person's argument, an agent that stores whichever
 * spelling it was handed back in its session list, and this process's own
 * `cwd`. Two places in this package care, and they have to care the same way —
 * {@link ./agent.ts} matches a stored session's directory against ours, and
 * {@link ./memory.ts} names a file after ours and checks what is in it. A rule
 * decided twice is one that can grow a `resolve()` on one side only, and what
 * that costs here is silent: the remembered conversation is filed under a key
 * nothing looks for, and the panel opens somebody else's — which is the bug
 * this package just finished fixing.
 */

/**
 * One spelling of a directory path: no trailing slash. Not a resolve and not a
 * realpath — both of those touch the disk, and both of the callers are
 * comparing strings somebody else minted, possibly on another day.
 *
 * Counted rather than `replace(/\/+$/, "")`, which is what this was: the
 * regex is a polynomial-backtracking one on a string of many slashes, and the
 * string here comes off the wire from an agent (`js/polynomial-redos`, raised
 * by CodeQL on the PR that added this file). A trailing-slash trim needs no
 * engine, and this one is linear by construction.
 */
export const normalDirectory = (path: string): string => {
  let end = path.length;
  while (end > 0 && path.charAt(end - 1) === "/") end -= 1;
  return path.slice(0, end);
};

/** Two paths naming the same directory. */
export const sameDirectory = (a: string, b: string): boolean =>
  normalDirectory(a) === normalDirectory(b);
