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
    # (spinning ring = working, dim dot = awaiting). The same pip now
    # leads the canvas-tile title bar, reused verbatim, so the title and
    # the dock speak one agent-state vocabulary and track state together.
    When a Claude Code session is mocked with state "thinking"
    Then the tile title state pip should be "working"
    When the Claude Code session state changes to "waiting"
    Then the tile title state pip should be "awaiting"
    And there should be no page errors

  Scenario: Claude Code state updates from thinking to waiting
    When a Claude Code session is mocked with state "thinking"
    Then the tile chrome should show an agent indicator with state "thinking"
    When the Claude Code session state changes to "waiting"
    Then the tile chrome should show an agent indicator with state "waiting"
    And there should be no page errors

  Scenario: Interrupted (Esc) turn reads as waiting, not running
    When a Claude Code session is mocked with state "interrupted"
    Then the tile chrome should show an agent indicator with state "waiting"
    And there should be no page errors

  Scenario: Interrupting a tool call reads as waiting, not running
    When a Claude Code session is mocked with state "interrupted_tool_use"
    Then the tile chrome should show an agent indicator with state "waiting"
    And there should be no page errors

  Scenario: Claude Code state cycles waiting → thinking → waiting
    When a Claude Code session is mocked with state "waiting"
    Then the tile chrome should show an agent indicator with state "waiting"
    When the Claude Code session state changes to "thinking"
    Then the tile chrome should show an agent indicator with state "thinking"
    When the Claude Code session state changes to "waiting"
    Then the tile chrome should show an agent indicator with state "waiting"
    And there should be no page errors

  Scenario: Previous-session JSONL in the project dir doesn't confuse detection
    When a Claude Code session is mocked with state "thinking"
    And a newer stale previous-session JSONL exists in the same project dir
    Then the tile chrome should show an agent indicator with state "thinking"
    And there should be no page errors

  Scenario: Workspace switcher pings the branch on unread completion
    When a Claude Code session is mocked with state "waiting"
    And I create a terminal
    And I simulate an activity alert
    Then a workspace switcher branch should be notified
    And there should be no page errors

  Scenario: Visiting an unread agent clears its pill ping
    When a Claude Code session is mocked with state "waiting"
    And I create a terminal
    And I simulate an activity alert
    Then a workspace switcher branch should be notified
    When I click the notified workspace switcher branch
    Then no workspace switcher branch should be notified
    And there should be no page errors

  Scenario: Tile chrome shows task progress when Claude has tasks
    When a Claude Code session is mocked with state "tool_use"
    And the Claude Code session has 5 tasks with 3 completed
    Then the tile chrome should show task progress "3/5"
    And there should be no page errors

  Scenario: Tile chrome shows running-in-background state with workflow fan-out
    When a Claude Code session is mocked with state "running_background"
    Then the tile chrome should show an agent indicator with state "running_background"
    And the tile chrome should show workflow badge "deep-research"
    And there should be no page errors

  Scenario: A backgrounded Bash command is not a running-in-background state
    When a Claude Code session is mocked with state "background_bash"
    Then the tile chrome should show an agent indicator with state "waiting"
    And there should be no page errors

  Scenario: A running /fork promotes the idle main to running-in-background
    # A `/fork` ends the main's turn (idle) and runs a sub-agent in the
    # background. Its launch is a local-command echo, not a tool_result, so it's
    # invisible to the background-task accounting; the watcher detects it from the
    # fork's on-disk subagent transcript and promotes the idle main to working.
    # No workflow fan-out journal exists, so no badge — just the working pip.
    When a Claude Code session is mocked with state "fork"
    Then the tile chrome should show an agent indicator with state "running_background"
    And the tile title state pip should be "working"
    And there should be no page errors

  Scenario: An orphaned workflow (stale journal) settles to idle, not running
    When a Claude Code session is mocked with state "orphaned_workflow"
    Then the tile chrome should show an agent indicator with state "waiting"
    And there should be no page errors

  Scenario: A workflow launch with a Run ID but no journal does not spin forever
    When a Claude Code session is mocked with state "journalless_workflow"
    Then the tile chrome should show an agent indicator with state "waiting"
    And there should be no page errors

  Scenario: A trailing /compact summary reads as idle, not stuck working
    When a Claude Code session is mocked with state "compact"
    Then the tile chrome should show an agent indicator with state "waiting"
    And there should be no page errors

  Scenario: An AskUserQuestion prompt on screen promotes waiting to awaiting (screen scrape, #905)
    # AskUserQuestion buffers in the SDK, so the JSONL stays `waiting` the whole
    # time the prompt is up. kolu recognizes its `↑/↓ to navigate` select footer
    # on the rendered screen and promotes to awaiting_user — exercising the full
    # pipeline: live PTY screen → getScreenText poll → detector → dock badge.
    When a Claude Code session is mocked with state "waiting"
    Then the tile chrome should show an agent indicator with state "waiting"
    When the terminal renders a Claude AskUserQuestion prompt
    Then the tile chrome should show an agent indicator with state "awaiting_user"
    And there should be no page errors

  Scenario: Claude Code indicator disappears when session ends
    When a Claude Code session is mocked with state "thinking"
    Then the tile chrome should show an agent indicator with state "thinking"
    When the Claude Code session ends
    Then the tile chrome should not show an agent indicator
    And there should be no page errors
