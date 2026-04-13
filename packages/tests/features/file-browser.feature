Feature: File browser (Files tab)
  Lazy-loaded file tree in the right panel's Files tab.

  Background:
    Given the terminal is ready

  Scenario: Files tab shows file tree when opened
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    When I click the Files tab
    Then the files tab should be visible
    And the file tree should have entries
    And there should be no page errors

  Scenario: File tree shows directories before files
    When I press the toggle inspector shortcut
    When I click the Files tab
    Then the files tab should be visible
    And directories should appear before files in the tree
    And there should be no page errors

  Scenario: Expanding a directory loads its children
    When I press the toggle inspector shortcut
    When I click the Files tab
    Then the files tab should be visible
    When I expand the first directory in the file tree
    Then the expanded directory should have child entries
    And there should be no page errors

  Scenario: Refresh button reloads the file tree
    When I press the toggle inspector shortcut
    When I click the Files tab
    Then the files tab should be visible
    And the file tree should have entries
    When I click the file tree refresh button
    Then the file tree should have entries
    And there should be no page errors
