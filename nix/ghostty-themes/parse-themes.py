"""Parse all Ghostty theme files from a directory into a JSON array.

Usage: python parse-themes.py <ghostty-themes-dir>
Output: JSON array of { name, theme } objects on stdout, sorted by name.
"""

import json
import sys
from pathlib import Path

# Ghostty palette indices → ITheme field names
PALETTE_MAP = {
    0: "black", 1: "red", 2: "green", 3: "yellow",
    4: "blue", 5: "magenta", 6: "cyan", 7: "white",
    8: "brightBlack", 9: "brightRed", 10: "brightGreen", 11: "brightYellow",
    12: "brightBlue", 13: "brightMagenta", 14: "brightCyan", 15: "brightWhite",
}

# Ghostty config key → ITheme field name
KEY_MAP = {
    "background": "background",
    "foreground": "foreground",
    "cursor-color": "cursor",
    "cursor-text": "cursorAccent",
    "selection-background": "selectionBackground",
    "selection-foreground": "selectionForeground",
}


def parse_theme(path: Path) -> dict:
    theme = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if key == "palette":
            idx_str, _, color = value.partition("=")
            idx = int(idx_str.strip())
            if idx in PALETTE_MAP:
                theme[PALETTE_MAP[idx]] = color.strip()
        elif key in KEY_MAP:
            theme[KEY_MAP[key]] = value
    return theme


def main():
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <themes-dir>", file=sys.stderr)
        sys.exit(1)

    themes_dir = Path(sys.argv[1])
    result = []

    for path in sorted(themes_dir.iterdir()):
        if path.is_file():
            theme = parse_theme(path)
            result.append({"name": path.name, "theme": theme})

    json.dump(result, sys.stdout, indent=2)
    print()  # trailing newline


if __name__ == "__main__":
    main()
