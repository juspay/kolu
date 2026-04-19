Feature: Agent-aware worktree creation
  When creating a worktree from the command palette, the user can pick
  what runs in it — Plain shell or any agent CLI they've recently run.
  Selecting an agent creates the worktree AND writes the command to the
  new terminal's input so the agent starts immediately.

  The sub-palette only appears when the user has at least one known
  agent in their recent-agents MRU. With no agents, picking a recent
  repo behaves exactly like the pre-phase-2 flow (flat leaf → plain
  shell worktree) — first-run UX is unchanged.

  Background:
    Given the terminal is ready
    When I press the toggle inspector shortcut
    Then the right panel should be visible

  Scenario: Agent sub-palette appears under a recent repo when agents exist
    # `claude` is not installed in the test env, but the preexec hook
    # fires BEFORE execution — the OSC 633;E mark is emitted regardless
    # of whether the command runs successfully.
    When I set up a git repo at "/tmp/kolu-wt-agent-pick"
    And I run "cd /tmp/kolu-wt-agent-pick"
    And I run "claude --dangerously-skip-permissions"
    And I open the command palette
    And I select "New terminal" in the palette
    And I select "kolu-wt-agent-pick" in the palette
    Then palette item "Plain shell" should be visible
    And palette item "claude --dangerously-skip-permissions" should be visible
    And there should be no page errors

  Scenario: Picking an agent creates the worktree and writes the command
    When I set up a git repo at "/tmp/kolu-wt-agent-run"
    And I run "cd /tmp/kolu-wt-agent-run"
    And I run "claude --dangerously-skip-permissions"
    And I open the command palette
    And I select "New terminal" in the palette
    And I select "kolu-wt-agent-run" in the palette
    And I select "claude --dangerously-skip-permissions" in the palette
    Then the header CWD should show ".worktrees/"
    And the pill tree should show a worktree indicator
    # The new terminal is active; its buffer contains the agent command
    # (echoed by the shell at the first prompt after rc init settles).
    And the screen state should contain "claude --dangerously-skip-permissions"
    And there should be no page errors

  Scenario: Picking Plain shell creates a plain worktree terminal
    When I set up a git repo at "/tmp/kolu-wt-agent-plain"
    And I run "cd /tmp/kolu-wt-agent-plain"
    And I run "claude --dangerously-skip-permissions"
    And I open the command palette
    And I select "New terminal" in the palette
    And I select "kolu-wt-agent-plain" in the palette
    And I select "Plain shell" in the palette
    Then the header CWD should show ".worktrees/"
    And the pill tree should show a worktree indicator
    And there should be no page errors
