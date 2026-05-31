/**
 * Print the nix-system identifier for the host given as argv[2].
 *
 * Thin CLI wrapper around `@kolu/surface-nix-host`'s `resolveSystem`, exposed
 * so the example's `just run` recipe can do its per-host arch probe (to pick
 * the right `mini-ci-runner` `.drv`) without shelling `nix-instantiate` and
 * quote-stripping by hand — the same helper drishti's `just dev` uses.
 */

import { resolveSystem } from "@kolu/surface-nix-host";

const host = process.argv[2];
if (host === undefined || host.length === 0) {
  process.stderr.write("usage: probe-arch <host>\n");
  process.exit(2);
}

try {
  process.stdout.write(await resolveSystem(host));
} catch (err) {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
}
