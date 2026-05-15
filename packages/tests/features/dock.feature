@claude-mock
Feature: Dock
  Left-edge canonical live-terminal navigator. Cards mode is the
  default — awaiting agents get full cards with a tail preview + reply
  input, working agents get compact pills, idle/parked terminals get
  faded one-liners. Rail mode collapses every row to a single colored
  swatch. Mega mode embeds the workspace search panel inline.

  Background:
    Given the terminal is ready

  Scenario: Dock defaults to cards mode on first open
    Then the dock should be visible
    And the dock should default to cards mode

  Scenario: Dock surfaces awaiting Claude session as a full card
    When a Claude Code session is mocked with state "waiting"
    Then the dock should be visible
    When the dock is expanded
    Then the dock should show 1 card

  Scenario: Dock surfaces working Claude session as a compact pill
    When a Claude Code session is mocked with state "thinking"
    Then the dock should be visible
    When the dock is expanded
    Then the dock should show 0 cards
    And the dock should show 1 working pill

  Scenario: Dock collapses to rail and expands back to cards
    When I collapse the dock to rail
    Then the dock should be in "rail" mode
    When the dock is expanded
    Then the dock should be in "cards" mode

  Scenario: Cmd+B toggles the dock between rail and cards
    # The keyboard shortcut should drive the same rail ↔ cards state
    # the in-header chevron drives. Cards is the default, so the first
    # press collapses to rail; the second expands back.
    When I press the dock toggle shortcut
    Then the dock should be in "rail" mode
    When I press the dock toggle shortcut
    Then the dock should be in "cards" mode

  Scenario: Chrome-bar dock-toggle button toggles the dock
    # The chrome bar carries a dock-toggle button mirroring the right-
    # panel inspector toggle. Clicking it drives the same rail ↔ cards
    # state as the keyboard shortcut.
    When I click the chrome-bar dock toggle
    Then the dock should be in "rail" mode
    When I click the chrome-bar dock toggle
    Then the dock should be in "cards" mode

  Scenario: Dock stays visible in maximized-tile mode as a sidebar
    # When a tile is maximized, the dock renders as a flush left-panel
    # flex sibling (`data-maximized=""`) rather than the floating
    # absolute overlay it uses in tiled mode. The terminal naturally
    # takes the remaining width.
    When I double-click the title bar of canvas tile 1
    Then canvas tile 1 should be maximized
    And the dock should be visible
    And the dock should be in maximized mode

  Scenario: Foreground process surfaces on non-agent dock rows
    # Plain shells without an agent used to read as bare `repo · branch`
    # — a `~ ~` home-dir shell was indistinguishable from any other.
    # The quiet row now carries the foreground process title pulled
    # from `meta.foreground.title || .name`.
    When I run "sleep 5"
    Then the dock should show 1 foreground row containing "sleep"

  Scenario: Cmd+1 activates the first dock row (recency-sorted)
    # `Cmd+1..9` targets dock row order, not store insertion order.
    # The background terminal is t0; running echo populates its buffer
    # and lifts its recency above any new terminal. After creating a
    # second terminal (now active), Cmd+1 returns focus to t0 since it
    # leads the recency-sorted dock order.
    Given I run "echo first-dock-row"
    And I create a terminal
    When I press shortcut "Mod+1"
    Then the active terminal should show "first-dock-row"

  Scenario: Alt held reveals numeric shortcut hints on dock rows
    # Holding Alt/Option paints a `Cmd+N` hint on the first nine dock
    # rows so the user can see what the positional shortcut will
    # target. Releasing Alt removes the hints.
    Given I create a terminal
    Then no dock-row shortcut hints should be visible
    When I press and hold Alt
    Then the dock should show 2 shortcut hints
    When I release Alt
    Then no dock-row shortcut hints should be visible
