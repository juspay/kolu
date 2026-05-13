Feature: Comment mode (inline composer + tray roll-up)
  The Code tab's comment-mode toggle reveals a read-only comments tray;
  authoring happens in a line-anchored inline popover that opens when
  the user clicks a line. The tray accumulates comments across files,
  highlights itself when non-empty, and lets the user jump to / edit /
  delete each entry. Copy-to-clipboard serializes the queue to Markdown
  and clears the tray.

  Background:
    Given the terminal is ready
    When I press the toggle inspector shortcut
    Then the right panel should be visible

  # ── Toggle + tray visibility ──

  Scenario: comments tray is hidden by default and revealed by the toggle
    Given a Code tab in "browse" mode showing file "a.ts" with content "alpha\nbeta\ngamma\n"
    Then the comments tray should be hidden
    When I enable comment mode
    Then the comments tray should be visible

  # ── End-to-end: select line, type in inline popover, copy, auto-discard ──
  #
  # The file viewer is mounted before enabling comment mode so Pierre's
  # VirtualizedFile measures its viewport at full height. The popover
  # anchors to the selected line's `[data-selected-line]` element — so
  # the click on line 1 must happen AFTER comment mode is on, otherwise
  # the resulting selection commit doesn't trigger popover open.

  Scenario: add a code comment via the inline popover, copy, tray clears
    Given a Code tab in "browse" mode showing file "a.ts" with content "alpha\nbeta\ngamma\n"
    When I open file "a.ts" in the Code tab
    And I enable comment mode
    And I click the line number 1 in the file content
    Then the inline comment popover should be visible
    When I type "tighten this" into the inline comment composer
    And I press Enter to submit the inline comment
    Then the comments tray should list 1 comment
    When I click the Copy-to-clipboard button
    Then the clipboard text should contain "`a.ts:L1`"
    And the clipboard text should contain "tighten this"
    And the comments tray should list 0 comments

  # ── Edit an existing comment via tray pencil ──

  Scenario: edit a queued comment from the tray pencil
    Given a Code tab in "browse" mode showing file "a.ts" with content "alpha\nbeta\ngamma\n"
    When I open file "a.ts" in the Code tab
    And I enable comment mode
    And I click the line number 1 in the file content
    Then the inline comment popover should be visible
    When I type "first pass" into the inline comment composer
    And I press Enter to submit the inline comment
    Then the comments tray should list 1 comment
    When I click the edit pencil on comment 1
    Then the inline comment popover should be visible
    When I type "revised" into the inline comment composer
    And I press Enter to submit the inline comment
    Then the comments tray should list 1 comment
    When I click the Copy-to-clipboard button
    Then the clipboard text should contain "revised"

  # ── Persistence across reload ──
  #
  # The right panel and comment-mode toggle are persisted, so after
  # reload the panel restores itself and the toggle stays on. No second
  # "toggle inspector shortcut" — that would close the just-restored
  # panel.

  Scenario: queued comments survive a page reload
    Given a Code tab in "browse" mode showing file "a.ts" with content "alpha\nbeta\ngamma\n"
    When I open file "a.ts" in the Code tab
    And I enable comment mode
    And I click the line number 1 in the file content
    Then the inline comment popover should be visible
    When I type "persisted note" into the inline comment composer
    And I press Enter to submit the inline comment
    Then the comments tray should list 1 comment
    When I reload the page and wait for ready
    Then the comments tray should be visible
    And the comments tray should list 1 comment
