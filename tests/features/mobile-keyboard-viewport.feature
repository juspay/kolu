@mobile
Feature: Mobile visual viewport tracking
  The app root height must track `window.visualViewport.height` so that
  when the soft keyboard opens in landscape mode, the layout shrinks
  to the available space instead of being occluded. CSS `dvh` ignores
  the virtual keyboard by spec, so a JS bridge is required.

  Background:
    Given the terminal is ready

  Scenario: App root height matches visualViewport.height on load
    Then the app root height should match the visual viewport height

  Scenario: App root shrinks when visualViewport fires a resize event
    When the visual viewport shrinks by 300 pixels
    Then the app root height should match the visual viewport height
