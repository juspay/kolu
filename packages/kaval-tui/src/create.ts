import { randomUUID } from "node:crypto";
import {
  DEFAULT_SPAWN_SHELL,
  type PtyHostSpawnInput,
  type PtyHostSpawnResult,
} from "kaval";
import {
  composeSpawnEnv,
  CONTAINING_TERMINAL_ENV,
  pickEnv,
  SPAWN_ENV_PRESENTATION,
} from "kolu-pty";
import { commandName, sanitizeCell, shortId, tildeify } from "./render.ts";

export type CreateResult = PtyHostSpawnResult;

export function buildCreateInput(opts: {
  id: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  command?: readonly string[];
  extraEnv?: Record<string, string>;
  kavalSocket: string;
}): PtyHostSpawnInput {
  const env: Record<string, string> = composeSpawnEnv(opts.env);
  Object.assign(env, opts.extraEnv ?? {});
  env.KAVAL_SOCKET = opts.kavalSocket;
  return composeCreateInput({
    id: opts.id,
    cwd: opts.cwd,
    shell: env.SHELL,
    env,
    command: opts.command,
  });
}

export interface RemoteHostFacts {
  shell: string;
  home: string;
  path?: string;
}

const BASELINE_REMOTE_PATH =
  "/run/current-system/sw/bin:/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin";

export function buildRemoteCreateInput(opts: {
  id: string;
  host: RemoteHostFacts;
  localEnv: NodeJS.ProcessEnv;
  command?: readonly string[];
  extraEnv?: Record<string, string>;
}): PtyHostSpawnInput {
  const env: Record<string, string> = Object.assign(Object.create(null), {
    HOME: opts.host.home,
    SHELL: opts.host.shell || DEFAULT_SPAWN_SHELL,
    PATH: opts.host.path || BASELINE_REMOTE_PATH,
  });
  Object.assign(env, pickEnv(SPAWN_ENV_PRESENTATION, opts.localEnv));
  Object.assign(env, opts.extraEnv ?? {});
  return composeCreateInput({
    id: opts.id,
    cwd: opts.host.home,
    shell: opts.host.shell,
    env,
    command: opts.command,
  });
}

function stampTerminalIdentity(
  env: Record<string, string>,
  id: string,
): Record<string, string> {
  return { ...env, [CONTAINING_TERMINAL_ENV]: id };
}

function composeCreateInput(opts: {
  id: string;
  cwd: string;
  shell: string | undefined;
  env: Record<string, string>;
  command?: readonly string[];
}): PtyHostSpawnInput {
  const command = opts.command && opts.command.length > 0 ? opts.command : null;
  const commandRooted = command !== null;
  const argv = command ? [...command] : [opts.shell || DEFAULT_SPAWN_SHELL];
  return {
    id: opts.id,
    argv,
    commandRooted,
    cwd: opts.cwd,
    env: stampTerminalIdentity(opts.env, opts.id),
    initFiles: [],
  };
}

export function newPtyId(): string {
  return randomUUID();
}

export function formatCreate(
  result: CreateResult,
  opts: { program: string; home?: string },
): string {
  const program = sanitizeCell(commandName(opts.program));
  const cwd = sanitizeCell(tildeify(result.cwd, opts.home));
  return `spawned ${shortId(result.id)} · ${program} · ${cwd} (pid ${result.pid})`;
}
