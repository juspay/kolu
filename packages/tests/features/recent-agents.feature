Feature: Recent agents in command palette
  Agent CLIs the user has run previously appear under "Recent agents"
  in the command palette so they can be prefilled into the active
  terminal without retyping.

  Detection is automatic: kolu's preexec hook captures the command line
  via OSC 633;E, and commands whose first token matches a known agent
  binary (`claude`, `aider`, `opencode`, etc.) are pushed to a global
  MRU. Prompt/message flags are stripped so raw prompt text never lands
  in the persisted list.

  The entry lives at the root of the palette under the Active Terminal
  section — no drill into Debug required.

  Background:
    Given the terminal is ready

  Scenario: Known agent invocation surfaces under "Recent agents"
    # `claude` is not installed in the test env, but the preexec hook
    # fires BEFORE execution — the OSC 633;E mark is emitted regardless
    # of whether the command succeeds.
    When I run "claude --dangerously-skip-permissions"
    And I open the command palette
    Then palette item "Recent agents" should be visible
    When I select "Recent agents" in the palette
    Then the palette breadcrumb should show "Recent agents"
    And palette item "claude --dangerously-skip-permissions" should be visible
    And there should be no page errors

  Scenario: Drilling into Recent agents keeps focus on palette input
    # Same focus contract as Search workspaces / Theme: the drill-in
    # must leave focus in the palette input so the user can immediately
    # start typing to filter agents.
    When I run "claude --dangerously-skip-permissions"
    And I open the command palette
    And I select "Recent agents" in the palette
    Then the palette breadcrumb should show "Recent agents"
    And the palette search input should be focused
    And there should be no page errors

  Scenario: Prompt flag values are stripped before storage
    When I run "claude --model sonnet -p mysecret"
    And I open the command palette
    And I select "Recent agents" in the palette
    Then palette item "claude --model sonnet" should be visible
    And there should be no page errors

  Scenario: "Recent agents" is hidden when no agents have been run
    When I open the command palette
    Then palette item "Recent agents" should not be visible
    And there should be no page errors

  Scenario: Non-agent commands do not pollute the list
    When I run "ls /tmp"
    And I open the command palette
    Then palette item "Recent agents" should not be visible
    And there should be no page errors

  Scenario: A quoted flag value survives intact in the list (#1407)
    # Regression for the quote-loss bug: kolu captures the command by tokenizing
    # the typed line, which strips the shell quoting. The normalized form must
    # RE-QUOTE a value carrying JSON/spaces, or re-running the recent agent
    # word-splits it (the original symptom was `Error: Settings file not found:
    # {ultracode:`). The list must show the value still single-quoted.
    When I run "claude --dangerously-skip-permissions --settings '{\"ultracode\": true}'"
    And I open the command palette
    And I select "Recent agents" in the palette
    Then the palette breadcrumb should show "Recent agents"
    And palette item "claude --dangerously-skip-permissions --settings '{\"ultracode\": true}'" should be visible
    And there should be no page errors
