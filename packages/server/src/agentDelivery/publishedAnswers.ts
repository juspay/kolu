/**
 * IS THE PACKAGE HOSTS ARE DELIVERED NEW ENOUGH FOR THIS KOLU, AND CAN A HOST
 * TAKE IT AT ALL? — asked the way a host is delivered, as each kind of host.
 *
 * A host does not serve the floor this tree pins. It serves what kolu-server
 * DELIVERED it: upstream's newest PUBLISHED package, named by the
 * content-addressed index in the delivery bake. So a call kolu's contract
 * makes (`@kolu/agent-distro/models`' `HOST_PACKAGE_CALLS`) is answered on a
 * real host only once a package that answers it is PUBLISHED — and until then
 * every delivered host refuses the model question, however green this repo is.
 *
 * A host is sent one of two forms of that package (`closureRoute`): the
 * content-addressed rewrite when its Nix is on the publisher's line, else the
 * signed package as built. So this asks TWICE, once per form, each as a host
 * that takes it: the delivery's OWN pull (`realDeliveryOps(delivery).pull`,
 * the code kolu-server runs for a host, aimed at `localhost`) in a child
 * process whose Nix is that kind of host's Nix (first on `PATH`), whose store
 * is a fresh EMPTY one (`NIX_REMOTE=local?root=…`), and whose `HOME` and
 * `XDG_CACHE_HOME` are fresh too, so no store path and no remembered narinfo
 * answer stands in for upstream's cache. Each child then reads
 * `share/agent-distro/answers` out of the bundle it pulled, inside its scratch
 * store, with {@link parsePackageAnswers}, and fails naming
 * {@link missingPackageCalls} unless there are none.
 *
 * Each child fails unless the route its pull took is the one its Nix is for,
 * so a lane whose Nix choice went wrong cannot test one form twice. The two
 * Nixes come from kolu's pinned nixpkgs (`default.nix`'s `agent-published-nix`,
 * one directory per route).
 *
 * A LANE, NOT A SANDBOXED CHECK (`ci::agent-published`, `just
 * test-agent-published`): it reads an HTTPS index and pulls a closure from a
 * binary cache. A Nix check has no network, and a check that could not ask
 * would be the same silence this is here to end.
 *
 * It is RED while the pin is ahead of what upstream published, or while a form
 * of the published package cannot be fetched from upstream's cache alone, and
 * that red is the fact: some host cannot take, or cannot use, what kolu
 * delivers. It goes green when upstream publishes a package that a host of
 * each kind takes and that answers — nothing here changes.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { realDeliveryOps } from "./ops.ts";

/** The two forms a host may be sent, each the name of the directory under
 *  {@link NIX_BY_ROUTE_ENV} holding the Nix of a host that takes it. */
const ROUTES = ["content-addressed", "signed"] as const;
type Route = (typeof ROUTES)[number];

/** `default.nix`'s `agent-published-nix`: `<dir>/<route>/bin/nix`. */
const NIX_BY_ROUTE_ENV = "KOLU_AGENT_PUBLISHED_NIX";
/** Set on a child only: the route it asks as, and its scratch store's root. */
const ROUTE_ENV = "KOLU_AGENT_PUBLISHED_ROUTE";
const STORE_ROOT_ENV = "KOLU_AGENT_PUBLISHED_STORE_ROOT";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "")
    throw new Error(
      `${name} is unset — this script is run by \`just test-agent-published\` (ci::agent-published), which builds what it names. Run that recipe, never this file bare.`,
    );
  return value;
}

/** ONE KIND OF HOST: the delivery's own pull into this process's empty store,
 *  then the answers of the bundle it landed. */
async function asHost(route: Route, storeRoot: string): Promise<void> {
  const delivery = readAgentDistroDeliveryBake();
  if (delivery === null)
    throw new Error(
      `${AGENT_DISTRO_DELIVERY_ENV} is unset — this script is run by \`just test-agent-published\` (ci::agent-published), which builds the delivery and names it. Run that recipe, never this file bare.`,
    );
  const ops = realDeliveryOps(delivery);
  const hostNix = await ops.hostNixOf("localhost");
  const published = await ops.published(hostNix.system);
  const taken = closureRoute(hostNix, published);
  const said = (line: string): void => {
    process.stdout.write(`agent-published [${route}]: ${line}\n`);
  };
  said(
    `as a ${hostNix.system} host on Nix ${hostNix.nixVersion}: latest is agent-distro ${published.rev} at ${taken.storePath} (${taken.kind})`,
  );
  if (taken.kind !== route)
    throw new Error(
      `a host on Nix ${hostNix.nixVersion} is sent the ${taken.kind} form, but this child asks as a ${route} host — the Nix it was given is not that kind of host's, so this run would test one form twice`,
    );
  const pulled = await ops.pull({
    ssh: "localhost",
    label: `a host on Nix ${hostNix.nixVersion}`,
    hostNix,
    published,
    onProgress: (line) => said(`  | ${line}`),
  });
  if (!pulled.ok) throw new Error(pulled.message);
  const count = execFileSync(
    "nix",
    ["path-info", "--recursive", pulled.bundle],
    {
      encoding: "utf8",
    },
  )
    .split("\n")
    .filter((line) => line !== "").length;
  said(`pulled ${pulled.bundle} into an empty store: ${count} paths`);
  let answersText: string;
  try {
    answersText = readFileSync(
      `${storeRoot}${pulled.bundle}/${PACKAGE_ANSWERS_FILE}`,
      "utf8",
    );
  } catch (err) {
    // No answers file at all is upstream's oldest state: a package that
    // predates every call kolu makes, and says so by its absence.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    answersText = "";
  }
  const answers = parsePackageAnswers(answersText);
  const missing = missingPackageCalls(answers);
  said(`it answers [${answers.join(", ")}]`);
  if (missing.length > 0)
    throw new Error(
      `the published agent-distro (${published.rev}, ${pulled.bundle}) does not answer ${missing.join(", ")} — every host kolu delivers serves THAT package, so it refuses every model question this kolu asks. Publish the upstream commit that answers it; this check goes green with no change here.`,
    );
  said("the published package answers every call kolu makes");
}

/** EACH KIND OF HOST, in a child of its own: that host's Nix first on `PATH`,
 *  an empty store, and an empty `HOME` and narinfo cache — all removed after. */
function asEveryHost(): void {
  const nixByRoute = required(NIX_BY_ROUTE_ENV);
  const script = process.argv[1];
  if (script === undefined) throw new Error("no script path in argv");
  const failed: Route[] = [];
  for (const route of ROUTES) {
    const root = mkdtempSync(join(tmpdir(), `kolu-agent-published-${route}-`));
    try {
      for (const dir of ["home", "xdg"]) mkdirSync(join(root, dir));
      const storeRoot = join(root, "store");
      const child = spawnSync(process.execPath, [...process.execArgv, script], {
        stdio: "inherit",
        env: {
          ...process.env,
          PATH: `${join(nixByRoute, route, "bin")}:${process.env.PATH ?? ""}`,
          NIX_REMOTE: `local?root=${storeRoot}`,
          HOME: join(root, "home"),
          XDG_CACHE_HOME: join(root, "xdg"),
          [ROUTE_ENV]: route,
          [STORE_ROOT_ENV]: storeRoot,
        },
      });
      if (child.status !== 0) failed.push(route);
    } finally {
      // A scratch store's files are read-only; nothing here may outlive the run.
      execFileSync("chmod", ["-R", "u+w", root]);
      rmSync(root, { recursive: true, force: true });
    }
  }
  if (failed.length > 0)
    throw new Error(
      `a host sent the ${failed.join(" and the ")} form cannot take or use the published agent-distro — see its lines above`,
    );
  process.stdout.write(
    "agent-published: a host of each kind takes the published package, and it answers every call kolu makes\n",
  );
}

const asked = process.env[ROUTE_ENV];
if (asked === undefined) asEveryHost();
else {
  const route = ROUTES.find((one) => one === asked);
  if (route === undefined)
    throw new Error(`${ROUTE_ENV}=${asked} is not one of ${ROUTES.join(", ")}`);
  await asHost(route, required(STORE_ROOT_ENV));
}
