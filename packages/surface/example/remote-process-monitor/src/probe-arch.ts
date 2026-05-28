/**
 * Print the nix-system identifier for the host given as argv[2].
 *
 * Thin CLI wrapper around `@kolu/surface-nix-host`'s `resolveSystem`,
 * exposed so the example's `just dev` recipe can do its per-host arch
 * probe without shelling `nix-instantiate` + quote-stripping by hand.
 * Shell stays the right tool for the `just` layer; the probe stays the
 * library's responsibility.
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
