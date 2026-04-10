@mobile
Feature: Mobile sidebar drag handle
  On coarse-pointer devices, the sidebar card surface must stay scrollable,
  so drag-to-reorder activation moves to a small grip handle inside the
  card. Tapping the handle is a drag affordance only — it must not select
  the terminal.

  Background:
    Given the terminal is ready

  Scenario: Drag handle is rendered on coarse-pointer devices
    Then the sidebar drag handle should be visible

  Scenario: Card body uses touch-action pan-y so vertical scroll passes through
    Then the sidebar card should have touch-action "pan-y"

  Scenario: Tapping the drag handle does not switch the active terminal
    When I create a terminal
    And I note the active terminal
    And I tap the drag handle on a non-active sidebar entry
    Then the active terminal should be unchanged
