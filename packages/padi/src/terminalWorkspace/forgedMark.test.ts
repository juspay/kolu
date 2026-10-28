/**
 * The forgery fence at the sensor seam: a shell's `OSC 633;E` mark is a SENSOR.
 *
 * Anyone whose text the user displays (`cat` a file, curl, an ssh banner) can
 * emit the mark while the shell is idle, so it must never become a command kolu
 * types. Here a forged mark — `LD_PRELOAD=/x claude --settings '{}'`, the exact
 * shape the old normalizer would have kept and replayed on wake — is published
 * on the terminal's `commandRun` channel and the outcome is asserted end to end
 * through the fold:
 *
 *   - the only thing emitted is the "an agent may be launching, re-sample the
 *     foreground" signal, which carries no text;
 *   - the folded restore target stays `none` (a bare shell on restore);
 *   - the fold holds no argv and the remembered facts are untouched.
 */

import { inMemoryChannel } from "@kolu/surface/server";
import {
  seedMemory,
  seedSnapshot,
  type TerminalEvent,
  type TerminalGrid,
  type TerminalId,
  type TerminalPorts,
  type TerminalState,
} from "@kolu/terminal-vocab/schema";
import type { ForegroundSample } from "kaval";
import pino from "pino";
import { expect, it } from "vitest";
import { type FoldCtx, fold, restoreTargetOf } from "./fold.ts";
import {
  type CommandRunSample,
  freshAgentEngineState,
  startAgentCommandSensor,
} from "./sensors.ts";

const log = pino({ level: "silent" });
const ID = "11111111-1111-4111-8111-111111111111" as TerminalId;

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

const ctx: FoldCtx = { live: true, at: 1, runStartedAt: 0 };

it("a forged 633;E mark produces no restore target and no argv", async () => {
  const engine = freshAgentEngineState();
  const emitted: TerminalEvent[] = [];
  const signals = {
    cwd: inMemoryChannel<string>(),
    title: inMemoryChannel<string>(),
    commandRun: inMemoryChannel<CommandRunSample>(),
    foreground: inMemoryChannel<ForegroundSample>(),
    ports: inMemoryChannel<TerminalPorts>(),
    grid: inMemoryChannel<TerminalGrid>(),
  };
  const stop = startAgentCommandSensor(
    engine,
    ID,
    signals,
    (o) => emitted.push(o),
    log,
  );

  // The forgery: env assignment + value flag, i.e. a line the old normalizer
  // kept verbatim and a wake would have typed into a fresh shell.
  signals.commandRun.publish({
    command: "LD_PRELOAD=/x claude --settings '{}'",
    replayed: false,
  });
  await flush();
  stop();

  // The mark's ONLY effect is a foreground re-sample hint. There is no event
  // carrying its text — `commandRun` does not exist on `TerminalEvent` — so the
  // fold never sees it.
  expect(emitted).toEqual([{ kind: "agent", agent: "unknown", argv: [] }]);
  expect(engine.currentAgent).toBe("claude"); // a basename hint, nothing more

  let state: TerminalState = {
    snapshot: seedSnapshot("/work"),
    memory: seedMemory(),
    argv: [],
  };
  for (const o of emitted) state = fold(state, o, ctx);

  expect(restoreTargetOf(state)).toEqual({ kind: "none" });
  expect(state.argv).toEqual([]);
  expect(state.memory).toEqual(seedMemory());
});

it("the same mark cannot resurrect a target after a genuine agent ended", async () => {
  // A terminal that ran an agent and quit to a shell: the fold cleared the
  // target. A later forged mark (printed by `cat`, say) must not bring one back.
  const engine = freshAgentEngineState();
  const emitted: TerminalEvent[] = [];
  const signals = {
    cwd: inMemoryChannel<string>(),
    title: inMemoryChannel<string>(),
    commandRun: inMemoryChannel<CommandRunSample>(),
    foreground: inMemoryChannel<ForegroundSample>(),
    ports: inMemoryChannel<TerminalPorts>(),
    grid: inMemoryChannel<TerminalGrid>(),
  };
  const stop = startAgentCommandSensor(
    engine,
    ID,
    signals,
    (o) => emitted.push(o),
    log,
  );
  signals.commandRun.publish({
    command: "LD_PRELOAD=/x claude --settings '{}'",
    replayed: true,
  });
  await flush();
  stop();

  const quit: TerminalState = {
    snapshot: { ...seedSnapshot("/work"), agent: null },
    memory: seedMemory(),
    argv: [],
  };
  let state = quit;
  for (const o of emitted) state = fold(state, o, ctx);
  expect(restoreTargetOf(state)).toEqual({ kind: "none" });
  expect(state).toBe(quit); // `unknown` with no agent is a no-op
});
