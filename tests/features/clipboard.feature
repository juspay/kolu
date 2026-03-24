Feature: Clipboard image paste
  Verify the full browser-to-PTY image paste flow: an image placed in the
  browser clipboard, Ctrl+V in the terminal, and the server-side shim
  scripts (xclip, wl-paste) serving the uploaded image data.

  Background:
    Given the terminal is ready

  Scenario Outline: <tool> reads pasted clipboard image
    When I place an image in the browser clipboard
    And I press Ctrl+V in the terminal
    And I run "<command>"
    Then the screen state should contain "<expected>"

    Examples:
      | tool              | command                                                                       | expected  |
      | xclip TARGETS     | xclip -selection clipboard -t TARGETS -o                                      | image/png |
      | xclip bytes       | test $(xclip -selection clipboard -t image/png -o \| wc -c) -gt 0 && echo ok | ok        |
      | wl-paste TARGETS  | wl-paste -l                                                                   | image/png |
      | wl-paste bytes    | test $(wl-paste --type image/png \| wc -c) -gt 0 && echo ok                  | ok        |

  Scenario Outline: <tool> shim exits non-zero with no image
    When I run "<command>"
    Then the screen state should contain "exit:1"

    Examples:
      | tool     | command                                                |
      | xclip    | xclip -selection clipboard -t TARGETS -o; echo exit:$? |
      | wl-paste | wl-paste -l; echo exit:$?                              |
