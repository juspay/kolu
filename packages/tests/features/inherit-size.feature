Feature: New terminal inherits active terminal's size
  When a new terminal is created, it inherits the width and height of the
  currently active terminal — not the default size, and not the last-created
  terminal's size. This guards against the `resolveReferenceLayout` bug that
  walked tileIds backwards and picked the "last" terminal instead of the
  "active" one.

  Background:
    Given the terminal is ready

  Scenario: New terminal inherits active terminal's size, not last terminal's
    # Background auto-creates terminal 0 (default size).
    # Create terminal 1 (active, default size) and terminal 2 (active, default size).
    # Resize terminal 1 to non-default. Click terminal 1 to make it active.
    # Create terminal 3. Terminal 3 must have terminal 1's size (the active tile),
    # not terminal 2's size (the last-created tile).
    Given I create a terminal
    And I create a terminal
    When I resize created terminal 1 to width 1000 and height 700
    And I click created terminal 1
    And I create a terminal
    Then there should be 4 canvas tiles
    And created terminal 3 should have width 1000 and height 700
    And there should be no page errors

  Scenario: Successive creates chain the inherited size
    # Background auto-creates terminal 0 (default size).
    # Create terminal 1 (active, default size). Resize it. Create terminal 2.
    # Terminal 2 inherits terminal 1's resized size.
    # Note: After creating terminal 1, it's active. Resize doesn't change active.
    # So when we create terminal 2, terminal 1 is still active.
    Given I create a terminal
    When I resize created terminal 1 to width 1100 and height 600
    And I create a terminal
    Then created terminal 2 should have width 1100 and height 600
    And there should be no page errors
