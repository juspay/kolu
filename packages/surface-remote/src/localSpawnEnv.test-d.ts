/**
 * TYPE-LEVEL pin (PR1.5, #1872) — the localhost arm's composed env is REQUIRED, not
 * optional: a spawn without it must be a COMPILE error, so ambient full-inherit is
 * UNSPELLABLE (never a review catch). `tsc` GREEN over this file ⇒ the guarantee
 * holds; making `localEnv` optional (or `| undefined`) would compile the
 * `@ts-expect-error` lines below and fail the pin — reopening the seam #1880 left.
 */
import { dialAgentOnce } from "./dialAgentOnce";
import { buildAgentCommand } from "./host";
import { type AgentDerivation, directAgentDerivation } from "./agentDerivation";
import { sshConnector } from "./sshConnector";
import { TEST_BINARY_CACHE } from "./agentDerivation.testutil";

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
  host: "h",
  binary: "a",
  fatalPrefix: "a:",
  localEnv: {},
});

void dialAgentOnce({
  host: "h",
  binary: "a",
  fatalPrefix: "a:",
  // @ts-expect-error — `localEnv` may not be `undefined` on the one-shot dial either.
  localEnv: undefined,
});

void dialAgentOnce(
  // @ts-expect-error — `localEnv` omitted on the one-shot dial: required, same as the connector.
  {
    host: "h",
    binary: "a",
    fatalPrefix: "a:",
  },
);
