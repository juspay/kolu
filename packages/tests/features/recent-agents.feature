@claude-mock
Feature: Recent agents in command palette
  Agents kolu has DETECTED LIVE appear under "Recent agents" in the command
  palette so they can be prefilled into the active terminal without retyping.

  Detection is the same OS-derived observation that produces a restore target:
  an adapter matches the foreground process to a session file, and the row keeps
  the agent's KIND plus the flags its live process ran with. A shell's
  `OSC 633;E` mark is only a sensor — it never becomes a row, so text a user
  merely displays (`cat`, curl) cannot enter the list. Prompt/message flags are
  dropped by the per-agent stable-flag allowlist.

  The entry lives at the root of the palette under the Active Terminal
  section — no drill into Debug required.

  Background:
    Given the terminal is ready

  Scenario: A live agent surfaces under "Recent agents"
    When a fake Claude Code agent is running with the arguments "--dangerously-skip-permissions"
    And I open the command palette
    Then palette item "Recent agents" should be visible
    When I select "Recent agents" in the palette
    Then the palette breadcrumb should show "Recent agents"
    And palette item "claude --dangerously-skip-permissions" should be visible
    And there should be no page errors

  Scenario: Drilling into Recent agents keeps focus on palette input
    # Same focus contract as Terminals / Theme: the drill-in
    # must leave focus in the palette input so the user can immediately
    # start typing to filter agents.
    When a fake Claude Code agent is running with the arguments "--dangerously-skip-permissions"
    And I open the command palette
    And I select "Recent agents" in the palette
    Then the palette breadcrumb should show "Recent agents"
    And the palette search input should be focused
    And there should be no page errors

  Scenario: Flags outside the allowlist are stripped from the row
    # `-p` (prompt) is not a stable flag, so it and its value never reach the
    # MRU — the row keeps only the allowlisted `--model` pair.
    When a fake Claude Code agent is running with the arguments "--model sonnet -p mysecret"
    And I open the command palette
    And I select "Recent agents" in the palette
    Then palette item "claude --model sonnet" should be visible
    And there should be no page errors

  Scenario: Non-agent commands do not pollute the list
    When I run "ls /tmp"
    And I open the command palette
    Then palette item "Recent agents" should not be visible
    And there should be no page errors

  Scenario: A quoted flag value survives intact in the list (#1407)
    # The row is rendered from the process's EXACT argv token, so a value
    # carrying JSON/spaces stays one token; the palette re-quotes it for the
    # shell, or re-running the recent agent would word-split it (the original
    # symptom was `Error: Settings file not found: {ultracode:`).
    When a fake Claude Code agent is running with the arguments "--dangerously-skip-permissions --settings '{\"ultracode\": true}'"
    And I open the command palette
    And I select "Recent agents" in the palette
    Then the palette breadcrumb should show "Recent agents"
    And palette item "claude --dangerously-skip-permissions --settings '{\"ultracode\": true}'" should be visible
    And there should be no page errors

  Scenario: "Recent agents" is hidden when no agents have been run
    When I open the command palette
    Then palette item "Recent agents" should not be visible
    And there should be no page errors
