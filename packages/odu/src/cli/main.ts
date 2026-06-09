/**
 * odu — a CI runner you attach to. ஓடு: run.
 *
 *   odu run [recipe[@platform]…] [flags]   run the [metadata("ci")] DAG
 *   odu status [-o json]                   snapshot a live run's nodes
 *   odu logs [-f] <node>                   one node's log (replay + follow)
 *   odu monitor [-o json]                  live dashboard / transition stream
 *   odu dump                               resolved pipeline as JSON
 *   odu graph                              dependency graph (Mermaid)
 *   odu protect [--dry-run] [--branch B]   sync required status checks
 *
 * Strict by default: refuses a dirty tree, pins HEAD via `git worktree`,
 * posts commit statuses under `<recipe>@<platform>` contexts, splits logs
 * into `.ci/<sha>/<platform>/<recipe>.log`. Opt-outs: `--no-post` (strict,
 * no GitHub writes), `--no-snapshot` (live tree, implies --no-post),
 * `--no-strict` (≡ both — the dev-iteration one-flag opt-out).
 */

import { parseArgs } from "node:util";
import { runCommand } from "../coordinator/run";
import { loadJustPipeline, mermaidGraph } from "../just/ingest";
import { logsCommand, monitorCommand, statusCommand } from "./introspect";
import { protectCommand } from "./protect";

const USAGE = `usage: odu <run|status|logs|monitor|dump|graph|protect> [args]

run [recipe[@platform]…] [--platform P]… [--host P=ADDR]… [--root NAMEPATH]
    [--no-deps] [--no-strict] [--no-snapshot] [--no-post] [--progress json]
status [-o json]
logs [-f] <node>
monitor [-o json]
dump [--root NAMEPATH]
graph [--root NAMEPATH]
protect [--dry-run] [--branch B] [--platform P]…
`;

async function dispatch(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case "run": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          platform: { type: "string", multiple: true },
          host: { type: "string", multiple: true },
          root: { type: "string" },
          "no-deps": { type: "boolean" },
          "no-strict": { type: "boolean" },
          "no-snapshot": { type: "boolean" },
          "no-post": { type: "boolean" },
          progress: { type: "string" },
        },
      });
      if (values.progress !== undefined && values.progress !== "json") {
        throw new Error(`odu: unknown --progress format "${values.progress}"`);
      }
      return runCommand({
        selectors: positionals,
        platforms: values.platform ?? [],
        hostPins: values.host ?? [],
        root: values.root,
        noDeps: values["no-deps"] ?? false,
        noStrict: values["no-strict"] ?? false,
        noSnapshot: values["no-snapshot"] ?? false,
        noPost: values["no-post"] ?? false,
        progressJson: values.progress === "json",
      });
    }
    case "status": {
      const { values } = parseArgs({
        args: rest,
        options: { output: { type: "string", short: "o" } },
      });
      return statusCommand(values.output === "json");
    }
    case "logs": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { follow: { type: "boolean", short: "f" } },
      });
      const node = positionals[0];
      if (node === undefined) throw new Error("odu: logs needs a node id");
      return logsCommand(node, values.follow ?? false);
    }
    case "monitor": {
      const { values } = parseArgs({
        args: rest,
        options: { output: { type: "string", short: "o" } },
      });
      return monitorCommand(values.output === "json");
    }
    case "dump":
    case "graph": {
      const { values } = parseArgs({
        args: rest,
        options: { root: { type: "string" } },
      });
      const spec = loadJustPipeline(process.cwd(), { root: values.root });
      process.stdout.write(
        command === "dump"
          ? `${JSON.stringify(spec, null, 2)}\n`
          : mermaidGraph(spec),
      );
      return 0;
    }
    case "protect": {
      const { values } = parseArgs({
        args: rest,
        options: {
          "dry-run": { type: "boolean" },
          branch: { type: "string" },
          platform: { type: "string", multiple: true },
        },
      });
      return protectCommand({
        dryRun: values["dry-run"] ?? false,
        branch: values.branch,
        platforms: values.platform ?? [],
      });
    }
    case undefined:
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(USAGE);
      return command === undefined ? 1 : 0;
    default:
      process.stderr.write(`odu: unknown command "${command}"\n${USAGE}`);
      return 1;
  }
}

dispatch(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exit(1);
  },
);
