Feature: What the terminal shows is what the program drew
  A terminal is two screens that must never disagree: the one drawn in the
  browser and the one the program is writing to. Everything that moves a
  pane's box while a program is writing — opening a split, dragging the
  divider between panes, closing the split, zooming the font — is a chance
  for them to come apart, and when they do the person sees rows that were
  blanked, erased or left behind while the program carries on believing its
  screen is intact.

  The guarantee this feature holds: however the box moves, the text in the
  pane is the text the program put there. The cost, which is deliberate: the
  text no longer reflows while you drag — it snaps a moment after you stop.

  Background:
    Given the terminal is ready

  Scenario: A pane keeps the program's screen while its box moves
    Given a repainting program is running in the terminal
    Then the terminal shows exactly what the program drew
    And the terminal fills its pane horizontally, with its last row on the pane's floor
    When the program begins a burst of output
    And I create a sub-terminal via command palette
    Then the terminal takes its new size and shows exactly what the program drew
    When the program begins a burst of output
    And I drag the split divider up by 80 pixels
    Then the terminal takes its new size and shows exactly what the program drew
    When the program begins a burst of output
    And I toggle the sub-panel via command palette
    Then the terminal takes its new size and shows exactly what the program drew
    Given I note the font size
    When the program begins a burst of output
    And I zoom in 1 time
    Then the font size should be larger than before
    And the terminal takes its new size and shows exactly what the program drew
    And the terminal fills its pane horizontally, with its last row on the pane's floor
    And there should be no page errors
