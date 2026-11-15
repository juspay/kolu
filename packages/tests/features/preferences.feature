Feature: Server-side preferences
  Preferences persist on the server and survive page reloads.

  Background:
    Given the terminal is ready

  Scenario: Color scheme persists across reload
    When I click the settings button
    Then the settings popover should be visible
    When I click the "light" color scheme button
    Then the color scheme should be "light"
    When I reload the page and wait for ready
    When I click the settings button
    Then the color scheme should be "light"
    And there should be no page errors

  Scenario: Scroll lock toggle persists across reload
    When I click the settings button
    Then the settings popover should be visible
    When I click the scroll lock toggle
    Then the scroll lock toggle should be disabled
    When I reload the page and wait for ready
    When I click the settings button
    Then the settings popover should be visible
    Then the scroll lock toggle should be disabled
    And there should be no page errors

  Scenario: Attention alerts toggle persists across reload
    When I click the settings button
    Then the settings popover should be visible
    When I click the attention alerts toggle
    Then the attention alerts toggle should be disabled
    When I reload the page and wait for ready
    When I click the settings button
    Then the settings popover should be visible
    Then the attention alerts toggle should be disabled
    And there should be no page errors

  Scenario: Terminal renderer preference swaps the active tile and persists
    Then the terminal renderer should be "webgl"
    When I click the settings button
    Then the settings popover should be visible
    When I click the "dom" renderer button
    Then the terminal renderer should be "dom"
    When I reload the page and wait for ready
    Then the terminal renderer should be "dom"
    And there should be no page errors

  @retina
  Scenario: A tile keeps its grid when the renderer changes
    # The size of a terminal must not depend on how it is drawn. xterm's WebGL
    # renderer floors the character measurement to whole device pixels and its
    # DOM renderer does not, so a tile that changed renderer used to change
    # column count — and a column change resizes the PTY, which SIGWINCHes the
    # program inside it.
    #
    # Two things here are arrangement, and without EITHER of them this scenario
    # passes against the very bug it exists to catch (both measured against
    # master):
    #
    #   · @retina — a fractional device pixel ratio (2.25, the one the bug was
    #     measured at). At the harness default of 1, with a font this harness
    #     measures as a whole pixel, flooring changes nothing and the two
    #     renderers agree by accident.
    #   · the reload. Changing the renderer re-measures nothing by itself (no
    #     box moved), so the old grid simply survives. A reload measures the
    #     pane again from scratch, under the renderer the preference now
    #     names — which is when the two answers used to differ.
    Then the terminal renderer should be "webgl"
    When I remember the active terminal's grid
    When I click the settings button
    Then the settings popover should be visible
    When I click the "dom" renderer button
    Then the terminal renderer should be "dom"
    Then the active terminal's grid should stay unchanged
    When I reload the page and wait for ready
    Then the terminal renderer should be "dom"
    Then the active terminal's grid should stay unchanged
    And there should be no page errors
