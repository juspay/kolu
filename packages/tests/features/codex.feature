@codex-mock
Feature: Codex status detection
  When Codex is running in a terminal, the canvas tile chrome shows its
  current state (thinking, tool use, waiting) and the running context-token
  count.

  Requires KOLU_CODEX_DIR to point at a test-controlled directory and
  PATH to include a `codex` binary stub (a renamed `sleep` copy) so the
  foreground-basename check passes without a real Codex install. Both are
  seeded by hooks.ts.

  Background:
    Given the terminal is ready

  Scenario: Tile chrome shows Codex waiting state
    When a Codex session is mocked with state "waiting"
    Then the tile chrome should show a Codex indicator with state "waiting"
    And there should be no page errors

  Scenario: Context tokens reflect input_tokens from the rollout
    When a Codex session is mocked with state "thinking" and input tokens 47000
    Then the tile chrome should show a Codex indicator with state "thinking"
    And the tile chrome should show context tokens "47K"
    And there should be no page errors

  Scenario: Context tokens do not double-count cached input tokens
    When a Codex session is mocked with state "waiting"
    And the Codex rollout reports input tokens 30000 with cached input tokens 10000
    Then the tile chrome should show a Codex indicator with state "waiting"
    And the tile chrome should show context tokens "30K"
    And there should be no page errors

  Scenario: npm-shimmed Codex is detected via the OSC 633;E preexec hint
    # The fake-binary path above exercises `readForegroundBasename`, the
    # kernel-level half of `matchesAgent`. This scenario exercises the other
    # half — `lastAgentCommandName`, set from the shell's OSC 633;E preexec
    # hint — without which an npm-installed codex (kernel basename = "node",
    # not "codex") would silently fail detection. Regression guard for #677.
    When a Codex session is mocked with state "thinking" via an npm-shimmed CLI
    Then the tile chrome should show a Codex indicator with state "thinking"
    And there should be no page errors
