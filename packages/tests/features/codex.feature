@codex-mock
Feature: Codex status detection
  When Codex is running in a terminal, the canvas tile chrome shows its
  current state (thinking, tool use, waiting) and the running context-token
  count.

  The mock runs as a real foreground `codex` process inside the terminal and
  writes its own SQLite + rollout artifacts under the terminal's `$HOME`, so
  local and remote padi runs exercise the same discovery path.

  Background:
    Given the terminal is ready

  Scenario: Tile chrome shows Codex thinking state
    When a Codex session is mocked with state "thinking"
    Then the tile chrome should show a Codex indicator with state "thinking"
    And there should be no page errors

  Scenario: Tile chrome shows Codex tool-use state
    When a Codex session is mocked with state "tool_use"
    Then the tile chrome should show a Codex indicator with state "tool_use"
    And there should be no page errors

  Scenario: Tile chrome shows Codex waiting state
    When a Codex session is mocked with state "waiting"
    Then the tile chrome should show a Codex indicator with state "waiting"
    And there should be no page errors

  Scenario: Context tokens reflect input_tokens from the rollout
    # Regression guard for 944f19d: tokens_used column would have reported
    # a session-lifetime cumulative total in the millions. The per-turn
    # figure lives on info.last_token_usage.input_tokens in the JSONL.
    When a Codex session is mocked with state "thinking" and input tokens 47000
    Then the tile chrome should show a Codex indicator with state "thinking"
    And the tile chrome should show context tokens "47K"
    And there should be no page errors

  Scenario: Context tokens do not double-count cached input tokens
    # Regression guard for 431edd3: summing input_tokens + cached_input_tokens
    # double-counted cache hits. OpenAI's schema puts the cached count inside
    # input_tokens already, so the badge should read 30K, not 40K.
    When a Codex session is mocked with state "waiting"
    And the Codex rollout reports input tokens 30000 with cached input tokens 10000
    Then the tile chrome should show a Codex indicator with state "waiting"
    And the tile chrome should show context tokens "30K"
    And there should be no page errors

  Scenario: npm-shimmed Codex is detected via the OSC 633;E preexec hint
    # The native mock-agent path above exercises `readForegroundBasename`, the
    # kernel-level half of `matchesAgent`. This scenario exercises the other
    # half — `lastAgentCommandName`, set from the shell's OSC 633;E preexec
    # hint — without which an npm-installed codex (kernel basename = "node",
    # not "codex") would silently fail detection. Regression guard for #677.
    When a Codex session is mocked with state "thinking" via an npm-shimmed CLI
    Then the tile chrome should show a Codex indicator with state "thinking"
    And there should be no page errors
