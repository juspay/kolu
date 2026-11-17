import { describe, expect, it } from "vitest";
import { aboutBlock } from "./aboutBlock.ts";

describe("what the Conductor is told a message was about", () => {
  it("names a terminal by `host/id`, the name every kolu tool takes", () => {
    expect(
      aboutBlock([
        {
          kind: "terminal",
          terminalId: "33cf0e6a-1111-4111-8111-111111111111",
          host: "remote:naiveintent",
          name: "chat-on-any-entity",
          intent: "plan the chat",
          cwd: "/home/me/code/olai",
        },
      ]),
    ).toBe(
      "[kolu] about terminal chat-on-any-entity (remote:naiveintent/33cf0e6a-1111-4111-8111-111111111111) · /home/me/code/olai — plan the chat",
    );
  });

  it("names a work by its title and the id `works` lists it under, one line each", () => {
    expect(
      aboutBlock([
        {
          kind: "work",
          work: "branch:local/%2Fhome%2Fme%2Fcode%2Folai/chat-in-a-pane",
          title: "Page chats open in a pane",
        },
        {
          kind: "terminal",
          terminalId: "9ab1e6a0-2222-4222-8222-222222222222",
          host: "local",
          name: "main",
          intent: null,
          cwd: null,
        },
      ]),
    ).toBe(
      [
        "[kolu] about work “Page chats open in a pane” (branch:local/%2Fhome%2Fme%2Fcode%2Folai/chat-in-a-pane)",
        "[kolu] about terminal main (local/9ab1e6a0-2222-4222-8222-222222222222)",
      ].join("\n"),
    );
  });
});
