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

  Scenario: tmux send-keys and capture-pane round-trip
    When I create a sub-terminal via the tmux shim
    And I send keys "echo tmux-test-marker" via the tmux shim to the new pane
    And I send key Enter via the tmux shim to the new pane
    And I wait 1 second
    And I capture the new pane via the tmux shim
    Then the captured text should contain "tmux-test-marker"
    And there should be no page errors
