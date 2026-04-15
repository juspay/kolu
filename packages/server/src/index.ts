/**
 * Thin CLI entry point — parse flags, then hand off to the server.
 *
 * This file imports only `cleye` and the package manifest. All heavy
 * server modules are loaded via a dynamic `import("./server.ts")` that
 * runs AFTER `cli()` has had a chance to handle `--help` / `--version`
 * (both call `process.exit(0)` inside cleye). This means `--help` is
 * fast and side-effect-free — no state files created, no logging
 * initialised, no system calls made.
 */
import { cli } from "cleye";
import { DEFAULT_PORT } from "kolu-common/config";
import pkg from "../package.json" with { type: "json" };

const argv = cli({
  name: "kolu",
  version: pkg.version,
  flags: {
    host: {
      type: String,
      description: "Address to listen on",
      default: "127.0.0.1",
    },
    port: {
      type: Number,
      description: "Port to listen on",
      default: DEFAULT_PORT,
    },
    tls: {
      type: Boolean,
      description: "Enable HTTPS with auto-generated self-signed certificate",
      default: false,
    },
    tlsCert: {
      type: String,
      description: "Path to TLS certificate file (PEM)",
    },
    tlsKey: {
      type: String,
      description: "Path to TLS private key file (PEM)",
    },
    verbose: {
      type: Boolean,
      description: "Enable debug-level logging",
      default: false,
    },
    allowNixShellWithEnvWhitelist: {
      type: String,
      description:
        "Allow running inside a nix shell, forwarding only these comma-separated env vars to PTY shells (dev/test only). Uses built-in default list if set to 'default'.",
    },
  },
  strictFlags: true,
});

// cleye calls process.exit(0) for --help/--version before reaching here.
// Dynamic import: all server modules (and their init functions) load only now.
const { startServer } = await import("./server.ts");
await startServer(argv.flags);
