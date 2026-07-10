@codex-npm-real @real-agent
Feature: npm-shimmed Codex detected via the OSC 633;E command-hint
  Stage-5 PORT (srid-approved: "real codex through a real npm shim"). Unlike
  codex-real.feature, which drives the NATIVE codex binary, this drives the
  NODE-distributed codex (the npm runtime, from the same sadjow pin) pointed at
  ollama through the throwaway $HOME. Its foreground process is `node`, not
  `codex`, so kolu's kernel-basename check (readForegroundBasename) cannot match
  it — detection MUST fall back to the shell's OSC 633;E preexec command-hint
  (lastAgentCommandName = "codex", from the typed launch command). This is the
  #673/#677 regression made real: an npm-installed codex that would silently
  fail detection without the command-hint path.

  Background:
    Given the terminal is ready

  Scenario: A node-distributed (npm) codex is still detected as codex
    # Launched from KOLU_E2E_CODEX_NODE_BIN (foreground basename `node`); the tile
    # carrying kind=codex proves the OSC 633;E command-hint path fired — the
    # kernel-basename path can't match `node` against `codex`.
    When I launch the real CodexNpm agent with prompt "Say the single word DONE and then stop."
    Then the tile chrome should show a CodexNpm indicator within 60 seconds
    # It wrote a real codex session at the default path under the throwaway home.
    And a real CodexNpm session file should exist at the default path
    And there should be no page errors
