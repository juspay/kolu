/**
 * The projection, over values.
 *
 * These are the payloads a real agent sends, written out by hand from the
 * adapter's own `dist/elicitation.js` (captured at 0.66.0) — a single-select
 * with an "Other" box, a multi-select, and the plan-mode permission request
 * whose first allow-flavoured option silently switched the session's permission
 * mode for as long as the panel answered these by machine.
 *
 * Nothing here needs a subprocess, which is the point of {@link ./asks.ts}
 * being pure: what a form LOOKS like for a question nobody has asked yet is a
 * unit test rather than a scenario nobody can write.
 */

import type {
  CreateElicitationRequest,
  RequestPermissionRequest,
} from "@agentclientprotocol/sdk";
import { describe, expect, test } from "vitest";

import {
  contentOf,
  type Form,
  formOf,
  hostOf,
  PERMISSION_FIELD,
  permissionFormOf,
  Refused,
  urlOf,
} from "./asks.ts";
import { type AskField, YES_NO } from "./wire.ts";

/** The shape `askUserQuestionsToCreateRequest` builds for ONE single-select
 *  question: the question itself as the message, a titled `oneOf`, and the
 *  per-question free-text companion beside it. */
const oneQuestion: CreateElicitationRequest = {
  mode: "form",
  sessionId: "s1",
  toolCallId: "call-1",
  message: "Which library should we use for date formatting?",
  requestedSchema: {
    type: "object",
    properties: {
      question_0: {
        type: "string",
        title: "Library",
        oneOf: [
          {
            const: "date-fns",
            title: "date-fns",
            description: "Tree-shakeable",
          },
          { const: "Luxon", title: "Luxon" },
        ],
      },
      question_0_custom: {
        type: "string",
        title: "Other",
        description:
          "Type your own answer instead of choosing an option above (optional).",
        _meta: {
          _askUserQuestionCustomAnswer: {
            questionId: "question_0",
            isCustomAnswer: true,
          },
        },
      },
    },
  },
};

const field = (fields: ReadonlyArray<AskField>, key: string): AskField => {
  const found = fields.find((each) => each.key === key);
  if (found === undefined) throw new Error(`no field \`${key}\``);
  return found;
};

const formIn = (request: CreateElicitationRequest) => {
  const form = formOf(request);
  if (form instanceof Refused) throw new Error(`undrawable: ${form.reason}`);
  return form;
};

describe("a question, as a form", () => {
  test("the message is the question and the options are the choices", () => {
    const form = formIn(oneQuestion);

    expect(form.message).toBe(
      "Which library should we use for date formatting?",
    );
    const choice = field(form.fields, "question_0");
    expect(choice.kind).toBe("choice");
    expect(choice.label).toBe("Library");
    expect(choice.choices).toEqual([
      { value: "date-fns", label: "date-fns", hint: "Tree-shakeable" },
      { value: "Luxon", label: "Luxon", hint: null },
    ]);
  });

  test("the free-text box says which question it belongs to", () => {
    // Drawn as a seventh field it would read as a second question. The marker
    // is un-namespaced in the adapter on purpose — several agents bridge their
    // own "ask the user" tool this way — so it is read as the shared thing it
    // is.
    expect(
      field(formIn(oneQuestion).fields, "question_0_custom"),
    ).toMatchObject({
      kind: "text",
      attachedTo: "question_0",
    });
  });

  test("a multi-select is a field that takes several", () => {
    const form = formIn({
      ...oneQuestion,
      message: "Please answer the following questions.",
      requestedSchema: {
        type: "object",
        properties: {
          question_0: {
            type: "array",
            title: "Features",
            description: "Which features do you want to enable?",
            items: {
              anyOf: [
                { const: "search", title: "Search" },
                { const: "journal", title: "Journal" },
              ],
            },
          },
        },
      },
    });

    expect(field(form.fields, "question_0")).toMatchObject({
      kind: "choices",
      label: "Features",
      hint: "Which features do you want to enable?",
    });
    expect(field(form.fields, "question_0").choices).toHaveLength(2);
  });

  test("a field with no title is left unlabelled rather than called `question_0`", () => {
    // The single-question case: the question travels as the message, and a
    // label invented from the property key is the schema's plumbing on screen.
    const form = formIn({
      ...oneQuestion,
      requestedSchema: {
        type: "object",
        properties: { question_0: { type: "string", enum: ["yes", "no"] } },
      },
    });
    expect(field(form.fields, "question_0").label).toBeNull();
    expect(field(form.fields, "question_0").choices).toEqual([
      { value: "yes", label: "yes", hint: null },
      { value: "no", label: "no", hint: null },
    ]);
  });

  test("the other primitives an MCP server may ask for are drawable", () => {
    const form = formIn({
      ...oneQuestion,
      requestedSchema: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", title: "Name" },
          age: { type: "integer", title: "Age" },
          rating: { type: "number", title: "Rating" },
          agree: { type: "boolean", title: "Agree?" },
        },
      },
    });
    expect(form.fields.map((each) => each.kind)).toEqual([
      "text",
      "integer",
      "number",
      "boolean",
    ]);
    expect(field(form.fields, "name").required).toBe(true);
    expect(field(form.fields, "age").required).toBe(false);
  });

  test("a field this panel cannot draw makes the whole question undrawable", () => {
    // Half a form is worse than none: somebody submits believing they answered
    // all of it, and the agent acts on the half that arrived. The caller
    // declines and SAYS so — never silently ignored.
    const refused = formOf({
      ...oneQuestion,
      requestedSchema: {
        type: "object",
        properties: {
          question_0: { type: "string", oneOf: [{ const: "a", title: "a" }] },
          weird: { type: "_something-new" },
        },
      },
    } as CreateElicitationRequest);

    expect(refused).toBeInstanceOf(Refused);
    expect((refused as Refused).reason).toContain("weird");
    expect((refused as Refused).reason).toContain("_something-new");
  });

  test("the form says which call it was asked from", () => {
    // `askUserQuestionsToCreateRequest` scopes an `AskUserQuestion` to the
    // tool use it came out of, and that call is the only thread back to WHICH
    // agent asked: unlike a permission request, the elicitation carries no
    // attribution of its own.
    expect(formIn(oneQuestion).toolCall).toBe("call-1");
  });

  test("a question scoped to no call says so rather than inventing one", () => {
    // A form elicitation may be scoped to a REQUEST instead of a session, and
    // an MCP server's may name no call. `null` is the honest answer, and it is
    // what stops a caller joining this to somebody else's row.
    const { toolCallId: _scoped, ...unscoped } =
      oneQuestion as CreateElicitationRequest & { toolCallId?: string };
    expect(formIn(unscoped as CreateElicitationRequest).toolCall).toBeNull();
  });

  test("a url elicitation is undrawable rather than half-drawn", () => {
    expect(
      formOf({
        mode: "url",
        sessionId: "s1",
        elicitationId: "e1",
        message: "Sign in",
        url: "https://example.invalid/auth",
      }),
    ).toBeInstanceOf(Refused);
  });
});

describe("a permission request, as the same form", () => {
  /**
   * The adapter's plan-mode exit, as it built it at that capture: four
   * options, `auto` FIRST and allow-flavoured — which is exactly the one a
   * client answering by machine picked, and the reason this whole path exists.
   *
   * The real list is filtered against the session's available modes, and gains
   * a leading `bypassPermissions` where the adapter allows it, so a session can
   * see fewer of these or one more. None of that changes what is being asserted:
   * whatever survives the filter, the first entry is allow-flavoured and is not
   * this panel's to choose.
   */
  const exitPlanMode: RequestPermissionRequest = {
    sessionId: "s1",
    toolCall: {
      toolCallId: "call-9",
      title: "Ready to code?",
      kind: "switch_mode",
    },
    options: [
      {
        kind: "allow_always",
        name: 'Yes, and use "auto" mode',
        optionId: "auto",
      },
      {
        kind: "allow_always",
        name: "Yes, and auto-accept edits",
        optionId: "acceptEdits",
      },
      {
        kind: "allow_once",
        name: "Yes, and manually approve edits",
        optionId: "default",
      },
      { kind: "reject_once", name: "No, keep planning", optionId: "plan" },
    ],
  };

  test("the tool call's title is the question and the options are the choices", () => {
    const form = permissionFormOf(exitPlanMode);

    expect(form.message).toBe("Ready to code?");
    expect(form.fields).toHaveLength(1);
    expect(form.fields[0]).toMatchObject({
      key: PERMISSION_FIELD,
      kind: "choice",
    });
    expect(form.fields[0]?.choices).toEqual([
      { value: "auto", label: 'Yes, and use "auto" mode', hint: null },
      { value: "acceptEdits", label: "Yes, and auto-accept edits", hint: null },
      {
        value: "default",
        label: "Yes, and manually approve edits",
        hint: null,
      },
      { value: "plan", label: "No, keep planning", hint: null },
    ]);
  });

  test("the form says which call it is about", () => {
    // The whole of what this package can honestly say about WHO is asking.
    // Which agent made `call-9` is an agent-specific `_meta` reading and lives
    // where the rest of them do; the call itself is the protocol's own word
    // and is the handle a caller joins the two by.
    expect(permissionFormOf(exitPlanMode).toolCall).toBe("call-9");
  });

  test("the order is the agent's own — nothing is sorted or preselected", () => {
    // Moving the reject to the front, or marking one as the safe default, would
    // be this layer having an opinion about which answer a person meant.
    const form = permissionFormOf(exitPlanMode);
    expect(form.fields[0]?.choices.map((choice) => choice.value)).toEqual([
      "auto",
      "acceptEdits",
      "default",
      "plan",
    ]);
  });
});

describe("a place to go, as the same row", () => {
  /** Codex's device-code sign-in, as `createUrlElicitationRequester` sends it
   *  (`codex-acp`'s `dist/index.js`: `elicitUrl` → `modes.client.elicitation.create`
   *  with the login's own `elicitationId`). The one difference that matters
   *  here is the scope: this is REQUEST-scoped, because it happens before any
   *  session exists. */
  const deviceCode: CreateElicitationRequest = {
    mode: "url",
    requestId: 7,
    url: "https://chatgpt.com/device",
    elicitationId: "login-3",
    message: "Sign in to ChatGPT and enter this code: WXYZ-12345",
  };

  test("the message is the agent's own and the fields are none", () => {
    const form = urlOf(deviceCode);
    expect(form).not.toBeInstanceOf(Refused);
    const card = form as Form;
    expect(card.message).toBe(
      "Sign in to ChatGPT and enter this code: WXYZ-12345",
    );
    expect(card.fields).toEqual([]);
    expect(card.link).toEqual({
      url: "https://chatgpt.com/device",
      host: "chatgpt.com",
    });
  });

  test("a session-scoped one names the call it was asked from", () => {
    // An MCP server's OAuth reaches the same reader with a session and a call;
    // the row is the same row and the provenance is the protocol's own field.
    const form = urlOf({
      ...deviceCode,
      toolCallId: "call-4",
      sessionId: "s1",
    } as CreateElicitationRequest);
    expect((form as Form).toolCall).toBe("call-4");
    expect((form as Form).link?.host).toBe("chatgpt.com");
  });

  test("a form is not a place to go", () => {
    expect(urlOf(oneQuestion)).toBeInstanceOf(Refused);
  });

  test("a mode this vocabulary does not know is refused, not read for a URL", () => {
    // The protocol keeps a catch-all arm for vendor modes, and one of those
    // must not be read as if it were this one.
    const custom = {
      mode: "_vendor",
      message: "?",
      url: "https://example.com",
    } as CreateElicitationRequest;
    expect(urlOf(custom)).toBeInstanceOf(Refused);
  });

  test("a URL this end cannot parse is carried whole", () => {
    // The honest failure: somebody has to be able to read the string they were
    // given, and a host invented out of it would be this end guessing where
    // they are about to be sent.
    expect(hostOf("not a url")).toBe("not a url");
  });

  test("the host keeps its port", () => {
    // A loopback sign-in is a different sentence from a vendor's.
    expect(hostOf("http://localhost:1455/auth/callback?code=x")).toBe(
      "localhost:1455",
    );
  });
});

describe("the answers, going back", () => {
  const fields = formIn(oneQuestion).fields;

  test("a picked option travels as the option's own value", () => {
    const content = contentOf(fields, [
      { key: "question_0", values: ["Luxon"] },
    ]);
    expect(content).toEqual({ question_0: "Luxon" });
  });

  test("a field left alone is absent rather than empty", () => {
    // Absent is the schema's own way of saying nothing was chosen, and the
    // adapter reads it as "skipped". An empty string would be an answer.
    const content = contentOf(fields, [
      { key: "question_0_custom", values: ["  "] },
    ]);
    expect(content).toEqual({});
  });

  test("a multi-select travels as the list it is", () => {
    const many: ReadonlyArray<AskField> = [
      {
        key: "question_0",
        label: null,
        hint: null,
        kind: "choices",
        choices: [
          { value: "a", label: "a", hint: null },
          { value: "b", label: "b", hint: null },
        ],
        required: false,
        attachedTo: null,
      },
    ];
    expect(
      contentOf(many, [{ key: "question_0", values: ["a", "b"] }]),
    ).toEqual({ question_0: ["a", "b"] });
  });

  test("a value the question never offered is refused, not passed on", () => {
    // The only way to answer a choice from the panel is to press a chip, so
    // this is about what else can reach the procedure. It matters because an
    // enum's `const` is what the agent reads back AS the answer: a value it
    // never offered is a sentence it never wrote, attributed to the person who
    // was asked.
    const refused = contentOf(fields, [
      { key: "question_0", values: ["mahogany"] },
    ]);
    expect(refused).toBeInstanceOf(Refused);
    expect((refused as Refused).reason).toContain("mahogany");

    // ... and the free-text box beside it still takes anything, which is what
    // it is for.
    expect(
      contentOf(fields, [{ key: "question_0_custom", values: ["mahogany"] }]),
    ).toEqual({ question_0_custom: "mahogany" });
  });

  test("a number is a number and a boolean is a boolean", () => {
    const typed: ReadonlyArray<AskField> = [
      {
        key: "age",
        label: "Age",
        hint: null,
        kind: "integer",
        choices: [],
        required: false,
        attachedTo: null,
      },
      {
        key: "agree",
        label: "Agree?",
        hint: null,
        kind: "boolean",
        choices: [],
        required: false,
        attachedTo: null,
      },
    ];
    // `YES_NO` rather than a spelling of our own: it is what the panel actually
    // writes into a boolean answer, so this is a round trip against the one
    // constant both ends read rather than two files agreeing by luck.
    expect(
      contentOf(typed, [
        { key: "age", values: ["41"] },
        { key: "agree", values: [YES_NO.no] },
      ]),
    ).toEqual({ age: 41, agree: false });
    expect(contentOf(typed, [{ key: "agree", values: [YES_NO.yes] }])).toEqual({
      agree: true,
    });
  });

  test("a number field given something else is refused, not coerced to zero", () => {
    const typed: ReadonlyArray<AskField> = [
      {
        key: "age",
        label: "Age",
        hint: null,
        kind: "integer",
        choices: [],
        required: false,
        attachedTo: null,
      },
    ];
    const refused = contentOf(typed, [{ key: "age", values: ["forty"] }]);
    expect(refused).toBeInstanceOf(Refused);
    expect((refused as Refused).reason).toContain("forty");
  });

  test("an answer for a field nobody asked for is refused", () => {
    // The form on screen is not the form that was sent, so nothing about the
    // rest of it can be trusted either.
    expect(
      contentOf(fields, [{ key: "question_7", values: ["x"] }]),
    ).toBeInstanceOf(Refused);
  });

  test("a required field left empty is refused", () => {
    const required: ReadonlyArray<AskField> = [
      {
        key: "name",
        label: "Name",
        hint: null,
        kind: "text",
        choices: [],
        required: true,
        attachedTo: null,
      },
    ];
    const refused = contentOf(required, []);
    expect(refused).toBeInstanceOf(Refused);
    expect((refused as Refused).reason).toContain("Name");
  });
});
