/**
 * Shared-artifact watchdog — every file both daemon generations touch must
 * have a mixed-version test registered in the coverage manifest
 * (`sharedArtifacts.testlib.ts`). Versioned entries must additionally declare
 * and execute a proof of their version+1 reader outcome.
 *
 * Coverage alone is not enough: a new shared file nobody registers would pass
 * a hand-list-only audit. Grounding lives in `previousRelease.e2e.test.ts`
 * (enumerates the live runtime dir + state-root after real daemons boot) and
 * is also unit-checked here with a synthetic disk layout that proves an
 * unregistered basename fails the matcher.
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { gatePid, readGateIdentity } from "@kolu/surface-daemon";
import {
  createSharedArtifactWatchdog,
  executeVersionDispositionProof,
  type ExecutedVersionDispositionProof,
  unknownProtocolFilesOnDisk,
  unknownSharedFileMessage,
} from "@kolu/surface-daemon/upgrade-window.testlib";
import {
  listPadiStateBackups,
  restorePadiStateBackup,
} from "../session/stateBackups.ts";
import {
  openPadiStateStores,
  PADI_STATE_SCHEMA_VERSION,
  requirePadiStateStores,
} from "../session/stateStore.ts";
import { SHARED_ARTIFACTS } from "./sharedArtifacts.testlib.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPERVISOR_SUITES = join(HERE, "../../../surface-daemon-supervisor/src");
const suiteFiles = new Set([
  ...readdirSync(HERE).map((name) => `padi/${name}`),
  ...readdirSync(SUPERVISOR_SUITES).map(
    (name) => `surface-daemon-supervisor/${name}`,
  ),
]);
const watchdog = createSharedArtifactWatchdog(SHARED_ARTIFACTS);

/** Prove the pid-first tolerant-reader law for one gate artifact:
 *  - plant a two-field (current) write and read the generation marker back
 *  - observe disposition by also exercising one-field (legacy) + legacy parseInt */
async function provePidFirstTolerant(
  artifact: (typeof SHARED_ARTIFACTS)[number],
  gatePath: string,
): Promise<ExecutedVersionDispositionProof> {
  const knownPid = 424_242;
  const startUnixUs = 1_700_000_000_000_000;
  const newerVersion = "two-field";
  return executeVersionDispositionProof({
    artifact,
    newerVersion,
    plant: () => {
      mkdirSync(dirname(gatePath), { recursive: true, mode: 0o700 });
      writeFileSync(gatePath, `${knownPid}\t${startUnixUs}\n`);
    },
    readPlantedVersion: () => {
      const fields = readFileSync(gatePath, "utf8").trim().split("\t");
      return fields.length >= 2 ? "two-field" : "one-field";
    },
    observeDisposition: () => {
      // Two-field write: modern reader gets pid + start; legacy parseInt gets pid.
      expect(gatePid(gatePath)).toBe(knownPid);
      expect(Number.parseInt(readFileSync(gatePath, "utf8").trim(), 10)).toBe(
        knownPid,
      );
      // One-field (legacy) plant: reader still yields the pid — the #2011 fix.
      writeFileSync(gatePath, `${knownPid}\n`);
      expect(readGateIdentity(gatePath)).toEqual({
        kind: "ok",
        pid: knownPid,
      });
      expect(gatePid(gatePath)).toBe(knownPid);
      // Genuine v3 (third tab field): still yields the pid — forward half of the law.
      writeFileSync(gatePath, `${knownPid}\t${startUnixUs}\textra\n`);
      expect(gatePid(gatePath)).toBe(knownPid);
      expect(readGateIdentity(gatePath)).toEqual({
        kind: "ok",
        pid: knownPid,
        startUnixUs,
      });
      // Non-tab future residue (parseInt tolerance): pid still usable.
      writeFileSync(gatePath, `${knownPid} ${startUnixUs} extra\n`);
      expect(gatePid(gatePath)).toBe(knownPid);
      expect(readGateIdentity(gatePath)).toEqual({
        kind: "ok",
        pid: knownPid,
      });
      return { kind: "pid-first-tolerant", pid: knownPid };
    },
  });
}

/** Prove the backup ring's version+1 disposition (#1658): a ring member is a
 *  byte-copy of `config.json` — version field included — so plant one whose
 *  copy carries version+1 AND a payload of a shape this build cannot decode,
 *  then observe every typed outcome the registry entry claims:
 *   - INERT TO BOOT: `openPadiStateStores` still answers `ready` (only the
 *     LIVE config's version gates the rollback preflight — a future member in
 *     the ring gates nothing);
 *   - LISTED, never collapsing: `backups.list` summarizes it;
 *   - RESTORE REFUSES: the undecodable payload throws before any store is
 *     touched, and the planted member's bytes survive untouched. */
async function proveBackupRingDisposition(): Promise<ExecutedVersionDispositionProof> {
  const ring = SHARED_ARTIFACTS.find(
    (artifact) => artifact.id === "padi-state-backup-ring",
  );
  if (ring === undefined) {
    throw new Error("padi-state-backup-ring missing from artifact registry");
  }
  const stateRoot = mkdtempSync(join(tmpdir(), "uw-ring-disposition-"));
  try {
    // A real current-version store, so the boot observation below is honest.
    requirePadiStateStores(stateRoot);
    const [major] = PADI_STATE_SCHEMA_VERSION.split(".").map(Number);
    const newerVersion = `${major! + 1}.0.0`;
    const memberName = "config.2099-01-01T00-00-00-000Z.json";
    const memberPath = join(stateRoot, "backups", memberName);
    let plantedBytes = "";
    return await executeVersionDispositionProof({
      artifact: ring,
      newerVersion,
      plant: () => {
        mkdirSync(join(stateRoot, "backups"), { recursive: true });
        plantedBytes = JSON.stringify({
          session: {
            terminals: [{ futureShape: true }],
            activeTerminalId: null,
            savedAt: 1,
          },
          __internal__: { migrations: { version: newerVersion } },
        });
        writeFileSync(memberPath, plantedBytes);
      },
      readPlantedVersion: () => {
        const member = JSON.parse(readFileSync(memberPath, "utf8")) as {
          __internal__?: { migrations?: { version?: unknown } };
        };
        return member.__internal__?.migrations?.version;
      },
      observeDisposition: async () => {
        // Inert to boot — the future member gates nothing.
        expect(openPadiStateStores(stateRoot).kind).toBe("ready");
        // Listed and summarized — a future member never collapses the list.
        const listed = listPadiStateBackups(stateRoot).backups.find(
          (backup) => backup.file === memberName,
        );
        expect(listed?.summary).toEqual({ kind: "session", terminals: 1 });
        // Restore REFUSES the undecodable payload, loudly and typed…
        await expect(
          restorePadiStateBackup(stateRoot, { file: memberName }),
        ).rejects.toThrow();
        // …and the member itself survives byte-for-byte.
        expect(readFileSync(memberPath, "utf8")).toBe(plantedBytes);
        return { kind: "inert-to-boot-restore-refuses" };
      },
    });
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
  }
}

describe("shared-artifact watchdog (upgrade-window)", () => {
  it("every non-log shared artifact has a real, executed disposition test", async () => {
    const stateConfig = SHARED_ARTIFACTS.find(
      (artifact) => artifact.id === "padi-state-root-config",
    );
    if (stateConfig === undefined) {
      throw new Error("padi-state-root-config missing from artifact registry");
    }
    const gateArtifacts = SHARED_ARTIFACTS.filter(
      (a) => a.versionDisposition === "pid-first-tolerant",
    );
    expect(gateArtifacts.map((a) => a.id).sort()).toEqual([
      "kaval-gate",
      "padi-gate",
      "padi-supervisor-gate",
    ]);

    const stateRoot = mkdtempSync(join(tmpdir(), "uw-version-disposition-"));
    const gateRoot = mkdtempSync(join(tmpdir(), "uw-gate-disposition-"));
    try {
      // Materialise today's Conf-owned projectVersion first. The proof helper
      // then owns the version+1 plant and verifies its effect from disk before
      // it will mint the receipt consumed by coverageGaps.
      requirePadiStateStores(stateRoot);
      const configPath = join(stateRoot, "config.json");
      const [major] = PADI_STATE_SCHEMA_VERSION.split(".").map(Number);
      const newerVersion = `${major! + 1}.0.0`;
      let plantedBytes = "";
      const configProof = await executeVersionDispositionProof({
        artifact: stateConfig,
        newerVersion,
        plant: () => {
          const config = JSON.parse(readFileSync(configPath, "utf8")) as {
            __internal__: { migrations: { version: string } };
          };
          config.__internal__.migrations.version = newerVersion;
          writeFileSync(configPath, JSON.stringify(config, null, "\t"));
          plantedBytes = readFileSync(configPath, "utf8");
        },
        readPlantedVersion: () => {
          const config = JSON.parse(readFileSync(configPath, "utf8")) as {
            __internal__?: { migrations?: { version?: unknown } };
          };
          return config.__internal__?.migrations?.version;
        },
        observeDisposition: () => {
          const disposition = openPadiStateStores(stateRoot);
          expect(disposition).toEqual({
            kind: "newer-project-version",
            configPath,
            runningVersion: newerVersion,
            supportedVersion: PADI_STATE_SCHEMA_VERSION,
          });
          expect(readFileSync(configPath, "utf8")).toBe(plantedBytes);
          return disposition;
        },
      });

      const gateProofs: ExecutedVersionDispositionProof[] = [];
      for (const artifact of gateArtifacts) {
        const basename = artifact.diskBasenames[0];
        if (basename === undefined) {
          throw new Error(`${artifact.id}: expected a disk basename`);
        }
        gateProofs.push(
          await provePidFirstTolerant(
            artifact,
            join(gateRoot, artifact.id, basename),
          ),
        );
      }

      const ringProof = await proveBackupRingDisposition();

      expect(
        watchdog.coverageGaps(suiteFiles, [
          configProof,
          ...gateProofs,
          ringProof,
        ]),
      ).toEqual([]);
    } finally {
      rmSync(stateRoot, { recursive: true, force: true });
      rmSync(gateRoot, { recursive: true, force: true });
    }
  });

  it("the inventory is non-empty and includes the core gate/socket/session trio", () => {
    const ids = new Set(SHARED_ARTIFACTS.map((a) => a.id));
    expect(ids.has("kaval-gate")).toBe(true);
    expect(ids.has("kaval-socket")).toBe(true);
    watchdog.assertInventory([
      "kaval-gate",
      "kaval-socket",
      "padi-session-blob",
      "padi-state-root-config",
      "padi-supervisor-gate",
    ]);
    // Mutate-to-prove: deleting kaval-gate from the inventory fails this pin.
    expect(SHARED_ARTIFACTS.length).toBeGreaterThanOrEqual(6);
  });

  it("versionField alone is red until a version+1 disposition test is registered", () => {
    const stateConfig = SHARED_ARTIFACTS.find(
      (artifact) => artifact.id === "padi-state-root-config",
    );
    if (stateConfig === undefined) {
      throw new Error("padi-state-root-config missing from artifact registry");
    }
    const versionOnly = [
      {
        ...stateConfig,
        coveredByTest: null,
      },
    ];
    expect(
      createSharedArtifactWatchdog(versionOnly)
        .coverageGaps(suiteFiles)
        .join("\n"),
    ).toMatch(/versionField=.*does not prove the version\+1 reader outcome/);
  });

  it("every protocol inventory entry that is a real file declares diskBasenames or patterns", () => {
    for (const a of SHARED_ARTIFACTS) {
      if (a.role === "log" || a.role === "session") continue;
      expect(
        a.diskBasenames.length + a.diskBasenamePatterns.length,
        `${a.id} is a protocol surface but has empty diskBasenames/patterns — the grounded sweep cannot match it`,
      ).toBeGreaterThan(0);
    }
  });

  it("grounded matcher: known layout is clean; an unregistered basename is red", () => {
    const runtime = mkdtempSync(join(tmpdir(), "uw-ground-rt-"));
    const state = mkdtempSync(join(tmpdir(), "uw-ground-sr-"));
    // A known layout — every basename/pattern is in the inventory.
    const kavalDir = join(runtime, "kaval-deadbeef");
    const padiDir = join(runtime, "padi-deadbeef");
    const termId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    mkdirSync(kavalDir, { recursive: true, mode: 0o700 });
    mkdirSync(padiDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(kavalDir, "kaval.pid"), "1\n");
    writeFileSync(join(kavalDir, "pty-host.sock"), ""); // placeholder file
    writeFileSync(join(kavalDir, "state-root"), `${state}\n`);
    writeFileSync(join(kavalDir, "kaval.log"), ""); // log — exempt
    writeFileSync(join(kavalDir, `bashrc-${termId}`), "# wrapper\n");
    // Darwin default shell is zsh — init lives under rc/zdotdir-<uuid>/.zshrc.
    const zdot = join(kavalDir, "rc", `zdotdir-${termId}`);
    mkdirSync(zdot, { recursive: true, mode: 0o700 });
    writeFileSync(join(zdot, ".zshrc"), "# zsh wrapper\n");
    writeFileSync(join(padiDir, "padi.pid"), "2\n");
    writeFileSync(join(padiDir, "supervisor.pid"), "3\n");
    writeFileSync(join(padiDir, "padi.sock"), "");
    writeFileSync(join(state, "config.json"), "{}");
    writeFileSync(join(state, "padi.log"), "");
    writeFileSync(join(state, "padi.log.1"), ""); // pino-roll generation
    writeFileSync(join(state, "padi.stderr.log"), "");

    expect(
      unknownProtocolFilesOnDisk(SHARED_ARTIFACTS, runtime, state),
    ).toEqual([]);

    // A .log suffix is not an exemption. Only a role:"log" registry row can
    // classify a file as diagnostic rather than protocol-bearing.
    writeFileSync(join(kavalDir, "protocol-surface.log"), "format=1\n");
    expect(
      unknownProtocolFilesOnDisk(SHARED_ARTIFACTS, runtime, state),
    ).toEqual([`kaval-deadbeef/protocol-surface.log`]);

    // Plant an unregistered shared file — the exact miss a hand-list-only
    // watchdog cannot catch. The matcher must name it (relative path).
    writeFileSync(join(kavalDir, "kaval.gate.v2"), "format=2\n");
    const unknown = unknownProtocolFilesOnDisk(
      SHARED_ARTIFACTS,
      runtime,
      state,
    );
    expect(unknown).toEqual([
      `kaval-deadbeef/kaval.gate.v2`,
      `kaval-deadbeef/protocol-surface.log`,
    ]);
    expect(unknownSharedFileMessage(SHARED_ARTIFACTS, unknown)).toMatch(
      /kaval\.gate\.v2/,
    );
    expect(unknownSharedFileMessage(SHARED_ARTIFACTS, unknown)).toMatch(
      /version\+1/,
    );
  });
});
