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

  Scenario: Tile chrome shows running-in-background state with workflow fan-out
    When a Claude Code session is mocked with state "running_background"
    Then the tile chrome should show an agent indicator with state "running_background"
    And the tile chrome should show workflow badge "deep-research"
    And there should be no page errors

  Scenario: An async sub-agent keeps an idle main in running-in-background state
    # An async `Agent`/`Task` launch lands on the main transcript as a `user`
    # `tool_result` confirmation ("Async agent launched successfully. (…)
    # agentId: <id>") and writes the same on-disk subagent artifacts as a
    # `/fork`. The confirmation positively identifies the run as background;
    # the artifacts' fresh streaming transcript is the liveness anchor. A
    # waiting main busy-waiting on that run must read as
    # `running_background`, never `waiting`.
    When a Claude Code session is mocked with state "async_subagent"
    Then the tile chrome should show an agent indicator with state "running_background"
    And there should be no page errors

  Scenario: A synchronously-launched sub-agent leaves the idle main at waiting
    # The negative twin of the scenario above: an ordinary synchronous
    # `Task`/`Explore`/skill sub-agent writes byte-identical on-disk
    # artifacts (still fresh right after it returns) but carries no
    # async-launch confirmation — it returned in-turn via `tool_result` and
    # emits no completion notification. Promoting on the artifacts alone
    # would publish a phantom `running_background` for the whole stale
    # window, suppressing the "your agent needs you" alert exactly when the
    # human is needed. The main must stay `waiting`.
    When a Claude Code session is mocked with state "sync_subagent"
    Then the tile chrome should show an agent indicator with state "waiting"
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

  Scenario: A tool-permission prompt on screen promotes tool_use to awaiting (screen scrape, #905)
    # A permission gate (Write/Edit/Bash/WebFetch approval) is on screen while the
    # tool call sits on disk, so the session reads as `tool_use`. kolu recognizes
    # the gate's footer (`Tab to amend`) on the rendered screen and promotes to
    # awaiting_user — same pipeline as AskUserQuestion, from the tool_use state.
    When a Claude Code session is mocked with state "tool_use"
    Then the tile chrome should show an agent indicator with state "tool_use"
    When the terminal renders a Claude permission prompt
    Then the tile chrome should show an agent indicator with state "awaiting_user"
    And there should be no page errors

  Scenario: Claude Code indicator disappears when session ends
    When a Claude Code session is mocked with state "thinking"
    Then the tile chrome should show an agent indicator with state "thinking"
    When the Claude Code session ends
    Then the tile chrome should not show an agent indicator
    And there should be no page errors
