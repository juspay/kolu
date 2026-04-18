Feature: Terminal
  Terminal canvas rendering, resizing, and keyboard shortcuts.

  Background:
    Given the terminal is ready

  Scenario: Terminal accepts input
    When I run "echo kolu-test"
    Then the terminal canvas should be visible
    And there should be no page errors

  Scenario: Terminal survives browser refresh
    When I run "echo kolu-refresh-test"
    And I refresh the page
    And the terminal is ready
    Then the terminal should contain "kolu-refresh-test"
    And there should be no page errors

  Scenario: Canvas fills its tile container
    # Canvas tiles are fixed-size on the freeform 2D canvas; the xterm fills
    # its tile, not the full viewport. The pre-#622 "shrink with viewport"
    # scenarios are removed — tile resize is a per-tile gesture now (the
    # eight resize handles), not a side-effect of window resize.
    Then the canvas should fill at least 90% of its container
    And there should be no page errors

  Scenario: Canvas fills container after zoom
    When I zoom in 2 times
    Then the canvas should fill at least 90% of its container
    When I zoom out 3 times
    Then the canvas should fill at least 90% of its container
    And there should be no page errors

  Scenario: Zoom shortcuts do not leak keystrokes
    Given I intercept oRPC sendInput calls
    When I zoom in 1 time
    And I zoom out 1 time
    Then no sendInput call should contain "=" "-" "+"
    And there should be no page errors

  Scenario: Initial resize is sent to PTY on connect
    When I run "echo $COLUMNS > /tmp/kolu-test-cols"
    Then the file "/tmp/kolu-test-cols" should contain a number greater than 80
    And there should be no page errors

  Scenario: Screen state includes scrollback beyond viewport
    When I run "for i in $(seq 1 50); do echo scrollback-line-$i; done"
    Then the screen state should contain "scrollback-line-1"
    And the screen state should contain "scrollback-line-50"
    And the screen state should have at least 50 lines
    And there should be no page errors

  Scenario: Scrollback retains more than 1000 lines
    When I generate 2000 lines of output
    Then the screen state should contain "scroll-test-1"
    And the screen state should contain "scroll-test-2000"
    And there should be no page errors

  Scenario: Clicking terminal focuses input
    When I click the terminal canvas
    Then the terminal input should be focused
    And there should be no page errors

  Scenario: Canvas refits its tile after tab visibility change
    # Tab-hidden xterms can lose their grid measurement. The post-visible
    # refit must re-fill the tile container regardless of viewport size.
    When I simulate a tab visibility change
    Then the canvas should fill at least 90% of its container
    And there should be no page errors

  Scenario: Zoom changes font size
    Given I note the font size
    When I zoom in 1 time
    Then the font size should be larger than before
    When I zoom out 2 times
    Then the font size should be smaller than the original
    And there should be no page errors
