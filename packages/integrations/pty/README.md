# kolu-pty

Decides what shell a terminal spawns, and with what environment. The thing
that owns a PTY lives in `kaval`; this package plans the spawn. One entry:
`.` (`src/index.ts`), backed by `src/shell.ts`. Node's standard library only,
no `node-pty` and no `xterm`.

## What it exports

- `SPAWN_ENV_ALLOWLIST` and its three classes, `SPAWN_ENV_FUNCTIONAL`,
  `SPAWN_ENV_PRESENTATION`, `SPAWN_ENV_OPERATIONAL`.
- `cleanEnv`, `pickEnv`, `composeSpawnEnv`, `koluIdentityEnv`,
  `configureNixShellEnv`, `NIX_ENV_WHITELIST`.
- `prepareShellInit` and its result types `ShellInitPlan` and `InitFile`: the
  shell arguments, the environment override, and the wrapper rc files to write.
- `prependPathEntries`, `PATH_PREPEND_CASES`, `PATH_REASSERT`,
  `readAgentToolsBake`, `AGENT_TOOLS_BAKE_ENV`, `TERMINAL_TOOLS_PATH_ENV`,
  `CONTAINING_TERMINAL_ENV`.

## Who uses it

`packages/server`, `kaval`, `kaval-tui`, `padi`, `padi-tui`, `kolu-cli`,
`packages/tests`, and the `git` integration. It has no workspace runtime
dependencies.

## What not to break

- `SPAWN_ENV_ALLOWLIST` is an allowlist. A key it does not name is dropped, so
  an identity variable that does not exist yet cannot ride the ambient
  environment into a spawned process. A new key must name the class it joins,
  and an identity variable has no class to claim.
- `SSH_AUTH_SOCK` is carried and `SSH_AGENT_PID` is not: signing is a
  capability a terminal needs, killing the agent is not.
- `TMPDIR` is load-bearing on macOS, where launchd mints a per-session
  temporary directory.
- `prepareShellInit` is pure. It plans rc files by name and content; the host
  writes them in the directory it owns and owns their lifetime. `rcDir` is
  passed in, because the host may be another machine.
- The wrapper rc file replays the user dotfiles the `--rcfile` or `ZDOTDIR`
  override suppresses. Drop an entry from the replay list and those settings
  vanish from every terminal whose parent environment is empty.
- Only bash and zsh get a plan. Everything else gets the environment prepend
  alone, and that bound is stated rather than widened quietly. The same bound
  is exported (`SHELLS_KOLU_WRAPS`, `isShellKoluWraps`) for a caller that must
  ASK a shell something rather than merely spawn it — padi's environment
  capture appends `-i -c`, which only these two take — so the reading lives
  here once.

`src/shell.test.ts` holds the contract.
