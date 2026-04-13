Feature: PWA install bar
  A dismissible top bar nudges browser users to install Kolu as a PWA.
  The bar only appears when not already running as an installed PWA.
  Dismissal is session-only — the bar reappears on each page load.

  Background:
    Given the terminal is ready

  Scenario: Install bar is visible in the browser
    Then the PWA install bar should be visible
    And there should be no page errors

  Scenario: Dismissing the bar hides it for the session
    Then the PWA install bar should be visible
    When I dismiss the PWA install bar
    Then the PWA install bar should not be visible
    And there should be no page errors

  Scenario: Install button appears when browser fires beforeinstallprompt
    Given the browser fires beforeinstallprompt
    Then the PWA install button should be visible
    When I click the PWA install button
    Then the browser install prompt should have been invoked
    And there should be no page errors
