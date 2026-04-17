@layout-compact
Feature: Responsive compact-dock layout
  Compact dock adapts between mobile (overlay) and desktop (in-flow) layouts.
  Pinned compact so the dock renders even at the desktop default viewport.

  Background:
    Given the terminal is ready

  Scenario: Sidebar visible by default on desktop
    Then the sidebar should be visible

  Scenario: Hamburger toggle hides and shows sidebar on desktop
    When I click the sidebar toggle
    Then the sidebar should not be visible
    When I click the sidebar toggle
    Then the sidebar should be visible

  Scenario: Sidebar hidden on mobile viewport
    When I resize the viewport to 375x667
    Then the sidebar should not be visible

  Scenario: Hamburger opens sidebar overlay on mobile
    When I resize the viewport to 375x667
    Then the sidebar should not be visible
    When I click the sidebar toggle
    Then the sidebar should be visible
    And the sidebar backdrop should be visible

  Scenario: Backdrop click closes sidebar on mobile
    When I resize the viewport to 375x667
    And I click the sidebar toggle
    Then the sidebar should be visible
    When I click the sidebar backdrop
    Then the sidebar should not be visible

  Scenario: Selecting terminal auto-closes sidebar on mobile
    Given I create a terminal
    When I resize the viewport to 375x667
    And I click the sidebar toggle
    Then the sidebar should be visible
    When I select terminal 1 in the sidebar
    Then the sidebar should not be visible

  Scenario: Sidebar does not overlap header on mobile
    When I resize the viewport to 375x667
    And I click the sidebar toggle
    Then the sidebar should be below the header
    And there should be no page errors
