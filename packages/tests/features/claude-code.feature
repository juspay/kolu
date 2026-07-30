@claude-mock
Feature: Claude Code status detection
  When Claude Code is running in a terminal, the canvas tile chrome shows
  its current state (thinking, tool use, waiting). The workspace switcher pings the
  branch when an agent has unread completion.

  Requires KOLU_CLAUDE_SESSIONS_DIR and KOLU_CLAUDE_PROJECTS_DIR env vars
  pointing the server at test-controlled directories.

  Background:
    Given the terminal is ready

  Scenario: Tile chrome shows Claude Code thinking state
    When a Claude Code session is mocked with state "thinking"
    Then the tile chrome should show an agent indicator with state "thinking"
    And there should be no page errors

  Scenario: Tile title leads with the dock's agent-state pip
    # The dock surfaces agent state via a shape-distinct StatePip
    # (spinning ring = working, violet dot = needs you). The same pip
    # leads the canvas-tile title bar, reused verbatim, so the title and
    # the dock speak one agent-state vocabulary and track state together.
    #
    # "awaiting" means BLOCKED ON YOU and nothing else. A turn that merely
    # ended is "linger" — the dimmed just-finished cue. The two used to
    # share the one name, which is exactly how a question waiting on a
    # human came to be drawn at the same strength as an agent that had
    # simply stopped.
    When a Claude Code session is mocked with state "thinking"
    Then the tile title state pip should be "working"
    When the Claude Code session state changes to "waiting"
    Then the tile title state pip should be "linger"
    When the Claude Code session state changes to "awaiting_user"
    Then the tile title state pip should be "awaiting"
    And there should be no page errors

  Scenario: Claude Code state updates from thinking to waiting
    When a Claude Code session is mocked with state "thinking"
    Then the tile chrome should show an agent indicator with state "thinking"
    When the Claude Code session state changes to "waiting"
    Then the tile chrome should show an agent indicator with state "waiting"
    And there should be no page errors

  Scenario: Workspace switcher pings the branch on unread completion
    When a Claude Code session is mocked with state "waiting"
    And I create a terminal
    And I simulate an attention alert
    Then a workspace switcher branch should be notified
    And there should be no page errors

  Scenario: Visiting an unread agent clears its pill ping
    When a Claude Code session is mocked with state "waiting"
    And I create a terminal
    And I simulate an attention alert
    Then a workspace switcher branch should be notified
    When I click the notified workspace switcher branch
    Then no workspace switcher branch should be notified
    And there should be no page errors

  Scenario: Tile chrome shows task progress when Claude has tasks
    When a Claude Code session is mocked with state "tool_use"
    And the Claude Code session has 5 tasks with 3 completed
    Then the tile chrome should show task progress "3/5"
    And there should be no page errors

  Scenario: An AskUserQuestion prompt on screen promotes thinking to awaiting (screen scrape, #905)
    # A pending AskUserQuestion reads as `thinking` on disk — the user's prompt is
    # the newest JSONL entry and the assistant's tool_use reply is buffered in the
    # SDK, so the screen scrape MUST promote from `thinking`, not only `waiting`
    # (gating to `waiting` left the dock stuck on "Thinking" with the prompt up).
    # kolu recognizes its `↑/↓ to navigate` footer on the rendered screen and
    # promotes to awaiting_user — the full pipeline from the real starting state.
    When a Claude Code session is mocked with state "thinking"
    Then the tile chrome should show an agent indicator with state "thinking"
    When the terminal renders a Claude AskUserQuestion prompt
    Then the tile chrome should show an agent indicator with state "awaiting_user"
    And there should be no page errors
