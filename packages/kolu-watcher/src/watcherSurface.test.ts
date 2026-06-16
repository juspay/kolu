/**
 * watcherSurface contract — shape + non-drift guards (pure, hermetic).
 *
 * `defineSurface` throws at construction on a duplicate (key, verb) claim, so
 * the mere fact that importing `watcherSurface` succeeds proves the absorbed
 * pty-host surface composes with the fs/git + metadata additions WITHOUT
 * collision. Beyond that we pin the two things a mirror bug could silently
 * break: the metadata value schema must BE kolu-common's (else the remote
 * mirror would drift from the local terminal record), and the absorbed
 * pty-host verbs/taps must actually be present on the wire (else
 * RemoteTerminalEndpoint could not forward a spawn/attach).
 */
import { TerminalMetadataSchema } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { WATCHER_CONTRACT_VERSION, watcherSurface } from "./watcherSurface.ts";

describe("watcherSurface contract", () => {
  it("composes the absorbed pty-host surface with fs/git + metadata without collision", () => {
    // Reaching here at all means defineSurface did not throw on a duplicate
    // (key, verb) claim across the three composed concerns.
    expect(watcherSurface.contract).toBeTruthy();
    expect(WATCHER_CONTRACT_VERSION).toBe("1.0");
  });

  it("pins terminalMetadata's value schema to kolu-common's (mirror cannot drift)", () => {
    expect(watcherSurface.spec.collections?.terminalMetadata.schema).toBe(
      TerminalMetadataSchema,
    );
  });

  it("absorbs the pty-host control verbs so kolu-server can forward them", () => {
    const procs = watcherSurface.spec.procedures ?? {};
    // The pty-host verbs kolu-server's RemoteTerminalEndpoint forwards.
    expect(procs.terminal?.spawn).toBeTruthy();
    expect(procs.terminal?.kill).toBeTruthy();
    expect(procs.terminal?.list).toBeTruthy();
    expect(procs.system?.version).toBeTruthy();
    expect(procs.system?.info).toBeTruthy();
    // The fs/git one-shots it forwards for the Code tab.
    expect(procs.git?.getStatus).toBeTruthy();
    expect(procs.fs?.readFile).toBeTruthy();
  });

  it("absorbs the pty-host tap streams + adds fs change streams", () => {
    const streams = watcherSurface.spec.streams ?? {};
    expect(streams.terminalAttach).toBeTruthy();
    expect(streams.cwd).toBeTruthy();
    expect(streams.foreground).toBeTruthy();
    expect(streams.exit).toBeTruthy();
    // The new fs change-notification streams.
    expect(streams.repoChange).toBeTruthy();
    expect(streams.fileChange).toBeTruthy();
  });
});
