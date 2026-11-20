import { formatKeybind, type Keybind } from "../input/keyboard";
import { isMac as detectedIsMac } from "../input/platform";
import { boolPref } from "../persistedPref";
import { createDisclosure } from "../ui/createDisclosure";
import { STEER_KEYBIND } from "./steer";

export type HelpSectionId =
  | "ask"
  | "waterfall"
  | "while-it-works"
  | "the-card"
  | "terminals"
  | "the-lock"
  | "files"
  | "mid-work"
  | "wakes"
  | "asks";

export interface HelpPart {
  readonly kind: "text" | "key" | "code" | "screen";
  readonly text: string;
}

export type HelpItem = readonly HelpPart[];

export interface HelpSection {
  readonly id: HelpSectionId;
  readonly heading: string;
  readonly items: readonly HelpItem[];
}

const text = (words: string): HelpPart => ({ kind: "text", text: words });
const code = (typed: string): HelpPart => ({ kind: "code", text: typed });
const screen = (word: string): HelpPart => ({ kind: "screen", text: word });

export function helpSections(
  isMac: boolean = detectedIsMac,
): readonly HelpSection[] {
  const key = (keybind: Keybind): HelpPart => ({
    kind: "key",
    text: formatKeybind(keybind, isMac),
  });
  return [
    {
      id: "ask",
      heading: "Ask",
      items: [
        [text("Type what you want done")],
        [
          key({ key: "@" }),
          text(" a piece of work, or a terminal on any host"),
        ],
        [key({ key: "/" }), text(" an agent command")],
      ],
    },
    {
      id: "waterfall",
      heading: "Build it end to end",
      items: [
        [code("waterfall fix the login error in ~/code/app")],
        [text("Answer its setup questions; it runs the rest")],
        [text("Your answers are kept, as the work’s decisions")],
      ],
    },
    {
      id: "while-it-works",
      heading: "While it works",
      items: [
        [text("The status line: what it is doing, for how long")],
        [text("The work: beside the chat, or behind the status line’s count")],
        [text("Needs you first, then the rest in progress")],
        [text("A chip on a reply names its work; click it to go there")],
        [text("A reply kolu was not asked for is one line; click to unfold")],
      ],
    },
    {
      id: "the-card",
      heading: "A piece of work",
      items: [
        [text("One card per branch: opening it again is the same work")],
        [text("Its stages: plan, approve, build, review, checks, merge")],
        [text("Each coloured by whose time: agents, you, CI")],
        [text("Click a stage to see its part of the timeline")],
        [text("Open it for the PR, the setup and the latest decisions")],
        [
          screen("About this work"),
          text(" points the chat at it; "),
          screen("Show all"),
          text(" ends that"),
        ],
        [screen("Copy link"), text(" copies its address, to paste anywhere")],
        [
          screen("Stop"),
          text(" ends it, "),
          screen("Reopen"),
          text(" brings it back with what it decided"),
        ],
      ],
    },
    {
      id: "terminals",
      heading: "Its terminals",
      items: [
        [text("Each one by the part it plays: planner, implementor")],
        [text("A name takes you to that terminal")],
        [screen("Look"), text(" peeks at its screen")],
        [text("Losing them says “no terminals”; the work is still there")],
      ],
    },
    {
      id: "the-lock",
      heading: "Who is typing",
      items: [
        [text("A terminal it drives is bordered; reading it is not gated")],
        [text("Type in it and a card offers "), screen("Take over")],
        [
          screen("Hand back"),
          text(" is the pill in its corner; it is told either way"),
        ],
      ],
    },
    {
      id: "files",
      heading: "What it wrote",
      items: [
        [text("A file opens in the reader, beside the chat")],
        [text("A folder is one chip with its count; click to unfold it")],
        [text("A file named in a reply opens that reply’s work’s copy")],
        [screen("Pop out"), text(" gives it a window of its own")],
        [text("Select text to comment, as on the Code tab")],
        [text("Kept when the work ends, after the worktree is gone")],
      ],
    },
    {
      id: "mid-work",
      heading: "Talk to it mid-turn",
      items: [
        [key({ key: "Enter" }), text(" queues after the turn")],
        [key(STEER_KEYBIND), text(" steers the turn, when offered")],
        [screen("■ Stop"), text(" ends the turn")],
      ],
    },
    {
      id: "wakes",
      heading: "It wakes itself",
      items: [
        [text("When a member’s agent is ready, stops, asks or leaves")],
        [text("Ready: its screen has settled, before it says a word")],
        [text("A "), screen("kolu"), text(" line in the chat is a wake")],
      ],
    },
    {
      id: "asks",
      heading: "When it asks you",
      items: [
        [text("Answer on the work’s card, or in the chat")],
        [text("Either one settles it; the card records which")],
        [
          text("Until then, the "),
          screen("Conductor"),
          text(" tab’s badge is violet"),
        ],
        [text("A green PR handed to you needs you too, on its card")],
      ],
    },
  ];
}

export const [helpOpen, setHelpOpen] = boolPref({
  name: "kolu-conductor-help-open",
  fallback: true,
});

export const helpSheet = createDisclosure();
