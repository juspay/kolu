/**
 * TYPE-LEVEL pin (PR1.5, #1872) — the localhost arm's composed env is REQUIRED, not
 * optional: a spawn without it must be a COMPILE error, so ambient full-inherit is
 * UNSPELLABLE (never a review catch). `tsc` GREEN over this file ⇒ the guarantee
 * holds; making `localEnv` optional (or `| undefined`) would compile the
 * `@ts-expect-error` lines below and fail the pin — reopening the seam #1880 left.
 *
 * The file pins every field whose OPTIONALITY would silently restore a fixed bug,
 * not just `localEnv`: `dialAgentOnce`'s `package` is here for the same reason —
 * see its case at the bottom.
 */
import { dialAgentOnce } from "./dialAgentOnce";
import { buildAgentCommand } from "./host";
import { type AgentDerivation, directAgentDerivation } from "./agentDerivation";
import { sshConnector } from "./sshConnector";
import {
  TEST_AGENT_SURFACE,
  TEST_BINARY_CACHE,
} from "./agentDerivation.testutil";

// AgentDerivation is nominal: consumers must use the validated direct constructor,
// and cannot forge a path/installable pair that resolves different agents.
// @ts-expect-error — the private brand is constructible only inside nixCopy.ts.
const _forgedDirect: AgentDerivation = {
  kind: "drv-path",
  drvPath: "/nix/store/x-agent.drv",
};
// @ts-expect-error — resolveAgentDrv alone constructs the flake-backed arm.
const _forgedFlake: AgentDerivation = {
  kind: "flake-installable",
  drvPath: "/nix/store/x-agent.drv",
  installable: "/nix/store/source#packages.x86_64-linux.other-agent",
};

// A composed env supplied → the only legal shape.
buildAgentCommand({
  host: "localhost",
  agentPath: "/p",
  binary: "a",
  localEnv: {},
});

buildAgentCommand({
  host: "localhost",
  agentPath: "/p",
  binary: "a",
  // @ts-expect-error — `localEnv` may not be `undefined`: the composed env is required.
  localEnv: undefined,
});

// @ts-expect-error — `localEnv` omitted: the localhost arm's composed env is required,
// so ambient full-inherit cannot be reintroduced by leaving it off.
buildAgentCommand({ host: "localhost", agentPath: "/p", binary: "a" });

// The connector options carry the same requirement (drishti / kolu callers plug in
// here, not at `buildAgentCommand`).
sshConnector({
  surface: TEST_AGENT_SURFACE,
  host: "h",
  binary: "a",
  resolveDrvPath: () =>
    Promise.resolve(
      directAgentDerivation("/nix/store/x-agent.drv", TEST_BINARY_CACHE),
    ),
  localEnv: {},
});

sshConnector(
  // @ts-expect-error — `localEnv` omitted on the connector options too.
  {
    host: "h",
    binary: "a",
    resolveDrvPath: () =>
      Promise.resolve(
        directAgentDerivation("/nix/store/x-agent.drv", TEST_BINARY_CACHE),
      ),
  },
);

sshConnector({
  surface: TEST_AGENT_SURFACE,
  host: "h",
  binary: "a",
  resolveDrvPath: () =>
    Promise.resolve(
      directAgentDerivation("/nix/store/x-agent.drv", TEST_BINARY_CACHE),
    ),
  // @ts-expect-error — `localEnv` may not be `undefined` on the connector either.
  localEnv: undefined,
});

// The one-shot public API (`dialAgentOnce`) carries the SAME requirement — the pin
// must cover it, since a future optional/default regression at THIS forwarding seam
// (dialAgentOnce → sshConnector → buildAgentCommand) would otherwise leave the
// advertised guarantee green while ambient full-inherit became spellable again.
void dialAgentOnce({
  surface: TEST_AGENT_SURFACE,
  host: "h",
  package: "a",
  binary: "a",
  fatalPrefix: "a:",
  localEnv: {},
});

void dialAgentOnce({
  surface: TEST_AGENT_SURFACE,
  host: "h",
  package: "a",
  binary: "a",
  fatalPrefix: "a:",
  // @ts-expect-error — `localEnv` may not be `undefined` on the one-shot dial either.
  localEnv: undefined,
});

void dialAgentOnce(
  // @ts-expect-error — `localEnv` omitted on the one-shot dial: required, same as the connector.
  {
    host: "h",
    package: "a",
    binary: "a",
    fatalPrefix: "a:",
  },
);

// `package` is required for the same reason and pinned the same way: it names the
// flake ATTR to provision, while `binary` names the program to exec inside it. A
// future `package?: string` defaulting to `binary` would silently reintroduce the
// two-closures bug — a host dialed with one attr built and another attr's binary
// run — with every pin above still green. Omit ONLY `package` here, so that
// regression is a compile error rather than a review catch.
void dialAgentOnce(
  // @ts-expect-error — `package` omitted on the one-shot dial: the provisioned attr is required, never derived from `binary`.
  {
    host: "h",
    binary: "a",
    fatalPrefix: "a:",
    localEnv: {},
  },
);
