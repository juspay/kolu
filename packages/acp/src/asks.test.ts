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
    expect(formIn(oneQuestion).toolCall).toBe("call-1");
  });

  test("a question scoped to no call says so rather than inventing one", () => {
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
    expect(permissionFormOf(exitPlanMode).toolCall).toBe("call-9");
  });

  test("the order is the agent's own — nothing is sorted or preselected", () => {
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
    const custom = {
      mode: "_vendor",
      message: "?",
      url: "https://example.com",
    } as CreateElicitationRequest;
    expect(urlOf(custom)).toBeInstanceOf(Refused);
  });

  test("a URL this end cannot parse is carried whole", () => {
    expect(hostOf("not a url")).toBe("not a url");
  });

  test("the host keeps its port", () => {
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
    const refused = contentOf(fields, [
      { key: "question_0", values: ["mahogany"] },
    ]);
    expect(refused).toBeInstanceOf(Refused);
    expect((refused as Refused).reason).toContain("mahogany");

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
