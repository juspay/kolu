import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  missingPackageCalls,
  PACKAGE_ANSWERS_FILE,
  parsePackageAnswers,
} from "@kolu/agent-distro/models";
import { type ClosureRoute, closureRoute } from "@kolu/surface-remote";
import {
  AGENT_DISTRO_DELIVERY_ENV,
  readAgentDistroDeliveryBake,
} from "./bake.ts";
import type { DeliveryStep } from "./delivery.ts";
import { realDeliveryOps } from "./ops.ts";

const ROUTES = [
  "content-addressed",
  "signed",
] as const satisfies readonly ClosureRoute["kind"][];
type Route = (typeof ROUTES)[number];

const NIX_BY_ROUTE_ENV = "KOLU_AGENT_PUBLISHED_NIX";

function unset(name: string): never {
  throw new Error(
    `${name} is unset — this script is run by \`just test-agent-published\` (ci::agent-published), which builds what it names. Run that recipe, never this file bare.`,
  );
}

function taken<T>(step: DeliveryStep<T>): T {
  if (!step.ok) throw new Error(step.message);
  return step.value;
}

async function asHost(asks: Route, storeRoot: string): Promise<void> {
  const ops = realDeliveryOps(
    readAgentDistroDeliveryBake() ?? unset(AGENT_DISTRO_DELIVERY_ENV),
  );
  const hostNix = taken(await ops.hostNixOf("localhost"));
  const published = taken(await ops.published(hostNix.system));
  const route = closureRoute(hostNix, published);
  const said = (line: string): void => {
    process.stdout.write(`agent-published [${asks}]: ${line}\n`);
  };
  said(
    `as a ${hostNix.system} host on Nix ${hostNix.nixVersion}: latest is agent-distro ${published.rev} at ${route.storePath} (${route.kind})`,
  );
  if (route.kind !== asks)
    throw new Error(
      `a host on Nix ${hostNix.nixVersion} is sent the ${route.kind} form, but this child asks as a ${asks} host — the Nix it was given is not that kind of host's, so this run would test one form twice`,
    );
  const progress: string[] = [];
  const pulled = await ops.pull({
    ssh: "localhost",
    label: `a host on Nix ${hostNix.nixVersion}`,
    hostNix,
    published,
    onProgress: (line) => progress.push(line),
  });
  if (!pulled.ok) {
    for (const line of progress) said(`  | ${line}`);
    throw new Error(pulled.message);
  }
  const bundle = pulled.value;
  const count = execFileSync("nix", ["path-info", "--recursive", bundle], {
    encoding: "utf8",
  })
    .split("\n")
    .filter((line) => line !== "").length;
  said(`pulled ${bundle} into an empty store: ${count} paths`);
  let answersText: string;
  try {
    answersText = readFileSync(
      `${storeRoot}${bundle}/${PACKAGE_ANSWERS_FILE}`,
      "utf8",
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    answersText = "";
  }
  const answers = parsePackageAnswers(answersText);
  const missing = missingPackageCalls(answers);
  said(`it answers [${answers.join(", ")}]`);
  if (missing.length > 0)
    throw new Error(
      `the published agent-distro (${published.rev}, ${bundle}) does not answer ${missing.join(", ")} — every host kolu delivers serves THAT package, so it refuses every model question this kolu asks. Publish the upstream commit that answers it; this check goes green with no change here.`,
    );
  said("the published package answers every call kolu makes");
}

function asEveryHost(): void {
  const nixByRoute = process.env[NIX_BY_ROUTE_ENV] || unset(NIX_BY_ROUTE_ENV);
  const script = process.argv[1];
  if (script === undefined) throw new Error("no script path in argv");
  const failed: Route[] = [];
  for (const route of ROUTES) {
    const root = mkdtempSync(join(tmpdir(), `kolu-agent-published-${route}-`));
    try {
      for (const dir of ["home", "xdg"]) mkdirSync(join(root, dir));
      const storeRoot = join(root, "store");
      const child = spawnSync(
        process.execPath,
        [...process.execArgv, script, "child", route, storeRoot],
        {
          stdio: "inherit",
          env: {
            ...process.env,
            PATH: `${join(nixByRoute, route, "bin")}:${process.env.PATH ?? ""}`,
            NIX_REMOTE: `local?root=${storeRoot}`,
            HOME: join(root, "home"),
            XDG_CACHE_HOME: join(root, "xdg"),
          },
        },
      );
      if (child.status !== 0) failed.push(route);
    } finally {
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

const [mode, asked, storeRoot] = process.argv.slice(2);
if (mode === undefined) asEveryHost();
else {
  const route = ROUTES.find((one) => one === asked);
  if (mode !== "child" || route === undefined || storeRoot === undefined)
    throw new Error(
      `usage: publishedAnswers.ts [child <${ROUTES.join("|")}> <storeRoot>] — \`just test-agent-published\` (ci::agent-published) runs it with no arguments, and it re-runs itself as a child per route`,
    );
  await asHost(route, storeRoot);
}
