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

  Scenario: Cmd+Shift+B toggles the dock between rail and cards
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

  Scenario: Mod held reveals numeric shortcut hints on dock rows
    # Holding the platform modifier (Cmd on macOS, Ctrl elsewhere)
    # paints a `Cmd+N` hint on the first nine dock rows — same modifier
    # as the shortcut itself, so the hint discovery mirrors the chord.
    # Releasing Mod removes the hints.
    Given I create a terminal
    Then no dock-row shortcut hints should be visible
    When I press and hold Mod
    Then the dock should show 2 shortcut hints
    When I release Mod
    Then no dock-row shortcut hints should be visible

  Scenario: Active terminal carries a visible indicator on its dock row
    # An accent strip pinned to the row's left edge reads as "this is
    # the active terminal" against any tile theme — the row's body has
    # its own bg color, so the strip sits outside the body chrome.
    Given I create a terminal
    Then the dock should show 1 active row indicator

  Scenario: Repo sections carry a colour spine and a sticky tinted header
    # Repo identity rides two high-mass surfaces, not a 9.6px label: a
    # repo-coloured spine down the section's left edge (the section
    # element draws it from the per-section `--repo-color` custom
    # property) and a sticky header band so the repo label survives the
    # scroll. Assert the structural facts via computed style, never a
    # class selector (see .claude/rules/e2e-testing.md).
    Given I create a terminal
    When the dock is expanded
    Then the dock section should carry a repo-colour spine
    And the dock section header should be sticky

  Scenario: Dock activity-window selector defaults to 24h and shares with the minimap
    # The dock header carries a compact `24h ▾` chip mirroring the
    # minimap's existing window picker. Both surfaces consume the same
    # `kolu-activity-window` localStorage signal, so picking a window in
    # one surface updates the other — one user truth, one persisted
    # choice. Default `24h` (from `DEFAULT_ACTIVITY_WINDOW` in
    # `activityWindow.ts`).
    Then the dock window trigger should be visible
    And the dock window should be "24h"
    And the minimap window should be "24h"
    When I click the dock window trigger
    And I pick the dock window option "12h"
    Then the dock window should be "12h"
    # Shared signal: same value lands on the minimap trigger without
    # an additional click.
    And the minimap window should be "12h"
    And there should be no page errors

  Scenario: Activity-window footer switches layout reactively on collapse
    # The footer is the same mounted component across a rail ↔ cards
    # toggle (the parent never remounts it), so its layout choice must be
    # reactive — a create-time `if (props.rail)` would freeze whichever
    # layout it first rendered. Start in the default cards layout, collapse
    # to rail, and the footer must re-render into the compact rail layout
    # rather than keep clipping the cards sentence inside the 44 px rail.
    Then the dock hidden footer should use the "cards" layout
    When I collapse the dock to rail
    Then the dock should be in "rail" mode
    And the dock hidden footer should use the "rail" layout
    When the dock is expanded
    Then the dock hidden footer should use the "cards" layout
    And there should be no page errors
