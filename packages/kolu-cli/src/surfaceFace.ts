import { padiSurface } from "@kolu/padi-client/surface";
import {
  type ResolvedEndpoint,
  surfaceCommands,
  type SurfaceCliHelp,
  surfaceHelp,
} from "@kolu/surface-cli";
import { Effect } from "effect";
import { Command } from "effect/cli";
import { KOLU_MCP_EXPOSE } from "kolu-mcp/expose";
import { KOLU_MCP_TOOLS } from "kolu-mcp/tools";
import type { koluRoot } from "./cli.ts";
import type { KoluCliConnection } from "./connect.ts";
import {
  type Endpoint,
  type EndpointFlagValues,
  endpointOf,
} from "./endpoint.ts";

const whereOf = (endpoint: Endpoint): string => {
  switch (endpoint.kind) {
    case "socket":
      return endpoint.path;
    case "stateRoot":
      return `--state-root ${endpoint.dir}`;
    case "host":
      return endpoint.ssh;
    case "auto":
      return "the discovered local padi";
  }
};

const dialOf = (
  endpoint: Endpoint,
): Effect.Effect<KoluCliConnection, unknown> =>
  endpoint.kind === "host"
    ? Effect.flatMap(
        Effect.promise(() => import("./hostConnect.ts")),
        ({ connectKoluCliViaHost }) => connectKoluCliViaHost(endpoint.ssh),
      )
    : Effect.flatMap(
        Effect.promise(() => import("./connect.ts")),
        ({ connectKoluCliLocal }) => connectKoluCliLocal(endpoint),
      );

const surfaceEndpointOf = (
  flags: EndpointFlagValues,
): Effect.Effect<ResolvedEndpoint, Error> =>
  Effect.map(
    Effect.mapError(endpointOf(flags), (err) => new Error(err.reason)),
    (endpoint) => ({
      where: whereOf(endpoint),
      open: () => Effect.runPromise(dialOf(endpoint)),
    }),
  );

export const KOLU_SURFACE_POSITIONALS = {
  screen_text: { positional: ["id"] },
  screen_image: { positional: ["id"] },
  screen_history: { positional: ["id"] },
  wait_outputSettled: { positional: ["id"] },
  wait_agentState: { positional: ["id"] },
  lifecycle_sendInput: { positional: ["id"] },
  agent_say: { positional: ["id"] },
  lifecycle_kill: { positional: ["id"] },
  watch_next: { positional: ["name"] },
  watch_close: { positional: ["name"] },
  fs_listAll: { positional: ["repoPath"] },
  fs_readFile: { positional: ["repoPath", "filePath"] },
  git_getStatus: { positional: ["repoPath"] },
  git_getDiff: { positional: ["repoPath", "filePath"] },
} as const;

const KOLU_SURFACE_GROUPS = [
  {
    title: "Drive a terminal",
    verbs: [
      "lifecycle_create",
      "agent_say",
      "lifecycle_sendInput",
      "lifecycle_kill",
    ],
  },
  {
    title: "Look at the screen",
    verbs: ["screen_text", "screen_image", "screen_history"],
  },
  {
    title: "Wait for it",
    verbs: ["wait_outputSettled", "wait_agentState"],
  },
  {
    title: "Watch the fleet",
    verbs: ["watch_open", "watch_next", "watch_close"],
  },
  {
    title: "Reach into the worktree",
    verbs: ["fs_listAll", "fs_readFile", "git_getStatus", "git_getDiff"],
  },
  {
    title: "Ask why it is slow",
    verbs: ["diagnostics_read"],
  },
] as const;

type KoluSurfaceVerb = (typeof KOLU_SURFACE_GROUPS)[number]["verbs"][number];

export const KOLU_SURFACE_HELP = {
  command: "surface",
  purpose:
    "Drive kolu's terminals, screens, and worktrees from a shell — the agent API of `kolu mcp`, as plain argv verbs.",
  groups: KOLU_SURFACE_GROUPS,
  examples: {
    lifecycle_create: `lifecycle_create --input '{"placement":{"kind":"toplevel"},"run":"claude"}'`,
    agent_say: `agent_say <id> --text 'skip the review on this one'`,
    lifecycle_sendInput: "lifecycle_sendInput <id> --text 'nix build'",
    lifecycle_kill: "lifecycle_kill <id>",
    screen_text: "screen_text <id> --tail 20",
    screen_image: "screen_image <id> --lines 40",
    screen_history: "screen_history <id> --max 100",
    wait_outputSettled: "wait_outputSettled <id> --idleMs 8000 --screenTail 20",
    wait_agentState: `wait_agentState <id> --until awaiting --until waiting --settledMs 15000`,
    watch_open: "watch_open --name work",
    watch_next: "watch_next work",
    watch_close: "watch_close work",
    fs_listAll: "fs_listAll /path/to/repo",
    fs_readFile: "fs_readFile /path/to/repo src/index.ts",
    git_getStatus: "git_getStatus /path/to/repo --mode branch",
    diagnostics_read: "diagnostics_read",
    git_getDiff: "git_getDiff /path/to/repo src/index.ts --mode branch",
  } satisfies Partial<Record<KoluSurfaceVerb, string>>,
  flags: [
    {
      spelling: "--socket <path>",
      description:
        "the padi socket to answer from — the default resolves the running service's",
    },
    {
      spelling: "--state-root <dir>",
      description:
        "a padi STATE ROOT, whose socket this face dials — how a second daemon answers the same verbs",
    },
    {
      spelling: "--host <name>",
      description:
        "a REMOTE host from the selector strip — the verbs answer over ssh",
    },
  ],
  answer:
    "One JSON value on stdout for a call, ndjson lines for a --follow'ed read — stdout is always data, prose is on stderr, and every refusal is the surface matrix's typed JSON with its own code: 1 the daemon refused, 2 the input never left this process, 3 nothing serving the endpoint, 130 interrupted. That is @kolu/surface-cli's matrix, NOT the native verbs' 1/2/3.",
} satisfies SurfaceCliHelp;

export const koluSurfaceFace = (root: typeof koluRoot) => {
  const projection = {
    core: { surface: padiSurface, expose: KOLU_MCP_EXPOSE },
    verbs: KOLU_MCP_TOOLS,
    endpoint: {
      resolve: () => Effect.flatMap(root, surfaceEndpointOf),
    },
    annotate: KOLU_SURFACE_POSITIONALS,
    help: KOLU_SURFACE_HELP,
    info: { name: "kolu" },
  } as const;
  return Command.make("surface").pipe(
    Command.withDescription(surfaceHelp(projection)),
    Command.withSubcommands(surfaceCommands(projection)),
  );
};
