Feature: tmux compatibility shim
  The kolu-tmux shim translates tmux commands into Kolu RPC calls,
  enabling Claude Code agent teams inside Kolu terminals.

  Background:
    Given the terminal is ready

  Scenario: Terminal list snapshot API
    Then the /api/terminals endpoint should return a JSON array with at least 1 terminal

  Scenario: Terminals have tmux environment variables
    When I run "echo TMUX=$TMUX"
    Then the screen state should contain "TMUX="
    And the screen state should not contain "TMUX=$TMUX"
    When I run "echo PANE=$TMUX_PANE"
    Then the screen state should contain "PANE=%"

  Scenario: tmux shim is on PATH
    When I run "which tmux"
    Then the screen state should contain "kolu-tmux-shim"

  Scenario: tmux -V returns version
    When I run "tmux -V"
    Then the screen state should contain "kolu-tmux 3.4"

  Scenario: tmux has-session succeeds
    When I run "tmux has-session -t kolu; echo exit=$?"
    Then the screen state should contain "exit=0"

  Scenario: tmux list-panes returns pane info
    When I run "tmux list-panes -F '#{pane_id} #{pane_current_path}'"
    Then the screen state should contain "%"

  Scenario: tmux display-message shows pane ID
    When I run "tmux display-message -p '#{pane_id}'"
    Then the screen state should contain "%"

  Scenario: tmux split-window creates a sub-terminal
    When I create a sub-terminal via the tmux shim
    Then the /api/terminals endpoint should return a JSON array with at least 2 terminal
    And there should be no page errors

  Scenario: tmux capture-pane reads terminal buffer
    When I run "echo cap-test-xyz"
    And the screen state should contain "cap-test-xyz"
    And I capture the current pane via the tmux shim
    Then the captured text should contain "cap-test-xyz"
    And there should be no page errors
