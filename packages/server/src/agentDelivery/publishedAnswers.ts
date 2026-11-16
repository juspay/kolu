/**
 * IS THE PACKAGE HOSTS ARE DELIVERED NEW ENOUGH FOR THIS KOLU? — the check
 * that was missing when the setup form shipped.
 *
 * A host does not serve the floor this tree pins. It serves what kolu-server
 * DELIVERED it: upstream's newest PUBLISHED package, named by the
 * content-addressed index in the delivery bake. So a call kolu's contract
 * makes (`@kolu/agent-distro/models`' `HOST_PACKAGE_CALLS`) is answered on a
 * real host only once a package that answers it is PUBLISHED — and until then
 * every delivered host refuses the model question, however green this repo is.
 *
 * This script asks that package, through the same reader kolu-server delivers
 * with ({@link readPublishedPackage}): read `latest` for a system off
 * upstream's index, realise that closure from upstream's own cache, read its
 * `share/agent-distro/answers` with {@link parsePackageAnswers}, and fail
 * naming {@link missingPackageCalls} unless there are none.
 *
 * A LANE, NOT A SANDBOXED CHECK (`ci::agent-published`, `just
 * test-agent-published`): it reads an HTTPS index and pulls a closure from a
 * binary cache. A Nix check has no network, and a check that could not ask
 * would be the same silence this is here to end.
 *
 * It is RED while the pin is ahead of what upstream published, and that red is
 * the fact: kolu's contract calls something hosts cannot answer yet. It goes
 * green when upstream publishes a package that answers — nothing here changes.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  missingPackageCalls,
  PACKAGE_ANSWERS_FILE,
  parsePackageAnswers,
} from "@kolu/agent-distro/models";
import { closureRoute } from "@kolu/surface-remote";
import {
  AGENT_DISTRO_DELIVERY_ENV,
  readAgentDistroDeliveryBake,
} from "./bake.ts";
import { readPublishedPackage } from "./ops.ts";

/** The system whose published package is asked when the caller names none —
 *  the one every CI lane and every Linux host takes. */
const DEFAULT_SYSTEM = "x86_64-linux";

/** This machine's own Nix version (`nix (Nix) 2.34.8` → `2.34.8`), which
 *  decides which published form it can verify — the same question
 *  `closureRoute` answers for a host. */
function localNixVersion(): string {
  const version = execFileSync("nix", ["--version"], { encoding: "utf8" })
    .trim()
    .split(/\s+/)
    .at(-1);
  if (version === undefined || version === "")
    throw new Error("`nix --version` printed nothing");
  return version;
}

/** Realise `storePath` from `cacheUrl` into this machine's store, and answer
 *  where it is. A content-addressed path needs no signature; a signed one is
 *  taken only with upstream's key named. */
function realise(
  storePath: string,
  cacheUrl: string,
  publicKey: string | null,
): string {
  execFileSync(
    "nix",
    [
      "copy",
      "--from",
      cacheUrl,
      ...(publicKey === null
        ? []
        : ["--option", "extra-trusted-public-keys", publicKey]),
      storePath,
    ],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
  return storePath;
}

async function main(): Promise<void> {
  const system = process.argv[2] ?? DEFAULT_SYSTEM;
  const delivery = readAgentDistroDeliveryBake();
  if (delivery === null)
    throw new Error(
      `${AGENT_DISTRO_DELIVERY_ENV} is unset — this script is run by \`just test-agent-published\` (ci::agent-published), which builds the delivery and names it. Run that recipe, never this file bare.`,
    );
  const entry = await readPublishedPackage(delivery.index, system);
  const route = closureRoute({ system, nixVersion: localNixVersion() }, entry);
  process.stdout.write(
    `agent-published: ${system} latest is agent-distro ${entry.rev} at ${route.storePath} (${route.kind})\n`,
  );
  const bundle = realise(
    route.storePath,
    delivery.cache.url,
    route.kind === "content-addressed" ? null : delivery.cache.publicKey,
  );
  let answersText: string;
  try {
    answersText = readFileSync(`${bundle}/${PACKAGE_ANSWERS_FILE}`, "utf8");
  } catch (err) {
    // No answers file at all is upstream's oldest state: a package that
    // predates every call kolu makes, and says so by its absence.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    answersText = "";
  }
  const answers = parsePackageAnswers(answersText);
  const missing = missingPackageCalls(answers);
  process.stdout.write(`agent-published: it answers [${answers.join(", ")}]\n`);
  if (missing.length > 0)
    throw new Error(
      `the published agent-distro (${entry.rev}, ${route.storePath}) does not answer ${missing.join(", ")} — every host kolu delivers serves THAT package, so it refuses every model question this kolu asks. Publish the upstream commit that answers it; this check goes green with no change here.`,
    );
  process.stdout.write(
    "agent-published: the published package answers every call kolu makes\n",
  );
}

await main();
