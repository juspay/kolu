/**
 * THE STANDING PROMPT, CHECKED RULE BY RULE.
 *
 * `teaching.md` is sent as the Markdown it is, so these tests read it as
 * Markdown: a section by its heading, a table by its rows, a rule by the one
 * list item or paragraph that states it. Each test names the rule it guards
 * (the inventory ids, R1…R92, from the change that compacted the script) and
 * looks for what the rule SAYS, not for a sentence — rewording a rule keeps it
 * green, deleting it turns it red. Where a list exists in the code (the wake
 * kinds, the modes, the roles, the setup keys, the served resources), the
 * test reads that list, so a new entry without its line in the script fails
 * the build. The tool names the script uses are checked against the fleet
 * face in `conductor.test.ts`; the rules the script leaves to a tool's own
 * description are checked on those descriptions in
 * `packages/kolu-mcp/src/fleet/fleet.test.ts`.
 */

import { parseTeaching, teaching } from "kolu-conductor";
import { ConductorWakeLevelSchema } from "kolu-common/conductor";
import {
  isKoluFleetAddress,
  KOLU_FLEET_RECORD_ADDRESS,
  KOLU_FLEET_RESOURCES,
} from "kolu-mcp";
import { KOLU_CHOICE_KEYS, ON_GREEN, WORK_MODES, WORK_ROLES } from "kolu-work";
import { describe, expect, it } from "vitest";

const SCRIPT = teaching("zest");

/** The text under a heading, up to the next heading of the same or a higher
 *  level. Throws when the heading is not there: a section that went missing
 *  is a rule set that went missing. */
function section(title: string): string {
  const lines = SCRIPT.split("\n");
  const at = lines.findIndex(
    (line) => /^#+ /.test(line) && line.replace(/^#+ /, "") === title,
  );
  if (at === -1) throw new Error(`teaching.md has no section "${title}"`);
  const level = (lines[at] ?? "").match(/^#+/)?.[0].length ?? 0;
  const end = lines.findIndex(
    (line, i) => i > at && (line.match(/^#+(?= )/)?.[0].length ?? 99) <= level,
  );
  return lines.slice(at + 1, end === -1 ? undefined : end).join("\n");
}

/** A section's blocks — each list item, table row or paragraph, its wrapped
 *  lines joined. A rule is stated in ONE block. */
function blocks(text: string): string[] {
  const out: string[] = [];
  let current: string[] = [];
  const flush = (): void => {
    if (current.length > 0) out.push(current.join(" ").replace(/\s+/g, " "));
    current = [];
  };
  for (const line of text.split("\n")) {
    if (line.trim() === "" || /^#+ /.test(line)) {
      flush();
      continue;
    }
    if (/^\s*(- |\| )/.test(line)) flush();
    current.push(line.trim());
  }
  flush();
  return out;
}

/** Does ONE block of the section state every one of these? */
const says = (text: string, ...patterns: ReadonlyArray<RegExp>): boolean =>
  blocks(text).some((block) => patterns.every((one) => one.test(block)));

/** A section's first Markdown table: its header cells and its rows. */
function table(text: string): {
  header: ReadonlyArray<string>;
  rows: ReadonlyArray<ReadonlyArray<string>>;
} {
  const cells = (line: string): string[] =>
    line
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((cell) => cell.trim());
  const lines = text.split("\n").filter((line) => line.trim().startsWith("|"));
  const [head, , ...body] = lines;
  if (head === undefined) throw new Error("no table in this section");
  return { header: cells(head), rows: body.map(cells) };
}

const WHO = section("Who you are");
const FLEET = section("The fleet");
const WORKS = section("Pieces of work");
const WAKES = section("Wakes");
const SPEAKING = section("Speaking to agents");
const ASKING = section("Asking the human");
const WATERFALL = section("The waterfall");
const SETUP = section("Setup");
const STEPS = table(section("Steps"));
const BRIEF = section("The brief");
const NEVER = section("Rules you never break");

/** One row of the waterfall table, by its step, as `{full, trivial}`. */
const step = (name: string): { full: string; trivial: string } => {
  const row = STEPS.rows.find((one) => one[0] === name);
  if (row === undefined) throw new Error(`the waterfall has no "${name}" step`);
  return { full: row[1] ?? "", trivial: row[2] ?? "" };
};

describe("the file and its loader", () => {
  it("fills the host in everywhere and leaves no placeholder behind", () => {
    expect(SCRIPT).not.toContain("{{");
    expect(SCRIPT).toContain("zest");
  });

  it("is sent as Markdown: it opens on kolu's heading and keeps its structure", () => {
    expect(SCRIPT.startsWith("# [kolu] ")).toBe(true);
    expect(SCRIPT).toMatch(/^## /m);
    expect(SCRIPT).toMatch(/^\| --- \|/m);
  });

  it("sends the file as written, minus only the leading note", () => {
    expect(
      parseTeaching("<!--\nnot sent\n-->\n\n# Title\n\n- one,\n  wrapped\n"),
    ).toBe("# Title\n\n- one,\n  wrapped");
  });

  it("refuses a placeholder it would not fill", () => {
    expect(() => parseTeaching("You run on {{hostname}}.")).toThrow(
      /unknown placeholder \{\{hostname\}\}/,
    );
  });

  it("refuses a file with nothing to say", () => {
    expect(() => parseTeaching("<!-- only a note -->\n\n")).toThrow(/empty/);
  });

  it("refuses a note after the leading one rather than sending it", () => {
    expect(() =>
      parseTeaching("<!-- editor -->\n\nSaid.\n\n<!-- stray -->\n\nAlso said."),
    ).toThrow(/only the leading <!-- note/);
  });
});

describe("who the Conductor is", () => {
  it("R1: runs on its host and reaches every host only through kolu's MCP server", () => {
    expect(
      says(WHO, /run on zest/, /every host/, /`kolu` MCP server/, /only/),
    ).toBe(true);
  });

  it("R2: never does the work itself; it runs the agents", () => {
    expect(says(WHO, /never do the work/, /agents/)).toBe(true);
  });

  it("R3: never waits — says what it set going and ends its turn", () => {
    expect(says(WHO, /never wait/i, /end your turn/, /wakes you/)).toBe(true);
  });

  it("R4: one plain sentence per step, never the tool's name", () => {
    expect(says(WHO, /one plain sentence/, /never name the tool/i)).toBe(true);
  });

  it("R5: keeps what is worth keeping in a file, not in its memory", () => {
    expect(
      says(WHO, /only this conversation/, /file on zest/, /agent writes/),
    ).toBe(true);
  });
});

describe("the fleet", () => {
  it("R6: a terminal is `host/id`, passed whole and read back", () => {
    expect(says(FLEET, /`host\/id`/, /whole name/, /read the host back/)).toBe(
      true,
    );
  });

  it("R7, R8, R11, R12, R22: names every resource the face serves, with its address, where it first names it", () => {
    const lines = SCRIPT.split("\n");
    for (const uri of KOLU_FLEET_RESOURCES) {
      const name = `\`${uri.split("/").at(-1)}\``;
      const first = lines.find((line) => line.includes(name));
      expect(first, `the script never names ${name}`).toBeDefined();
      expect(first, `${name} is first named without its address`).toContain(
        `\`${uri}\``,
      );
    }
  });

  it("R8: says the roster changes while it works, so it is read again", () => {
    expect(
      says(FLEET, /`hosts`/, /changes while you work/, /read it again/),
    ).toBe(true);
  });

  it("R11: says where one terminal's record is read, in full and unescaped", () => {
    expect(SCRIPT).toContain(KOLU_FLEET_RECORD_ADDRESS);
    expect(SCRIPT).toContain(
      KOLU_FLEET_RECORD_ADDRESS.replace("<host>/<id>", "remote:prod/"),
    );
    expect(SCRIPT).not.toContain("%2F");
  });

  it("teaches no address the face does not answer, and each resource once", () => {
    const taught = [...SCRIPT.matchAll(/surface:\/\/[^\s`"]+/g)].map(
      ([uri]) => uri,
    );
    expect(taught.length).toBeGreaterThan(0);
    for (const uri of taught)
      expect(isKoluFleetAddress(uri), `${uri} is answered by nothing`).toBe(
        true,
      );
    for (const uri of KOLU_FLEET_RESOURCES)
      expect(
        taught.filter((one) => one === uri),
        `${uri} taught twice`,
      ).toHaveLength(1);
  });

  it("R9: a host-not-connected refusal is the truth, not something to retry", () => {
    expect(says(FLEET, /not connected/, /truth/, /retry/)).toBe(true);
  });

  it("R10: a path never picks a host", () => {
    expect(says(FLEET, /path/, /several hosts/, /never picks\s+a host/)).toBe(
      true,
    );
  });

  it("R13: an asleep terminal is not gone: never reported missing, never re-read", () => {
    expect(
      says(
        FLEET,
        /asleep/,
        /not gone/,
        /never report it missing/,
        /never retry/,
      ),
    ).toBe(true);
  });

  it("R14: reads the record first, skips the sleeping, and tells the human how many", () => {
    expect(
      says(
        FLEET,
        /read its\s+record/,
        /skip the sleeping/,
        /how many are asleep/,
        /wake one/,
      ),
    ).toBe(true);
  });
});

describe("pieces of work", () => {
  it("R15: everything belongs to a work, opened first; nothing is created before", () => {
    expect(
      says(
        WORKS,
        /belongs to a piece of work/,
        /`work_open`/,
        /Nothing is created before/,
      ),
    ).toBe(true);
  });

  it("R16, R17: a work is its branch on its machine; never a second one", () => {
    expect(
      says(
        WORKS,
        /branch on its machine/,
        /open it/,
        /Never\s+start a second work/,
      ),
    ).toBe(true);
  });

  it("R18, R19, R73: the machine is the human's call — asked in the reply, never guessed or defaulted", () => {
    expect(
      says(
        WORKS,
        /Which machine/,
        /not a setup\s+question/,
        /ask in your reply/,
        /hosts connected now/,
        /end your turn/,
        /Never guess/,
        /never default to\s+zest/,
      ),
    ).toBe(true);
  });

  it("R22: reads `works` at the start of every conversation and after every restart", () => {
    expect(
      says(WORKS, /`works`/, /start of every conversation/, /restart/),
    ).toBe(true);
  });

  it("R24, R26, R30: creates INTO a work with a role, adopts, leaves, and keeps members to its own", () => {
    expect(
      says(
        WORKS,
        /`lifecycle_create`/,
        /`work`/,
        /`role`/,
        /`work_adopt`/,
        /`work_leave`/,
        /responsible for/,
      ),
    ).toBe(true);
    for (const role of WORK_ROLES) expect(WORKS).toContain(`\`${role}\``);
  });

  it("R28: losing its terminals does not end a work", () => {
    expect(
      says(
        WORKS,
        /does not end a work/,
        /no terminals/,
        /Bring terminals back/,
      ),
    ).toBe(true);
  });

  it("R29: a work ends only by its PR, or by a stop", () => {
    expect(says(WORKS, /ends only/, /merged or closed/, /`work_stop`/)).toBe(
      true,
    );
  });

  it("R31: about a work it writes only questions and notes", () => {
    expect(
      says(
        WORKS,
        /only questions \(`work_ask`\) and notes \(`work_note`\)/,
        /kolu records/,
      ),
    ).toBe(true);
  });

  it("R32: a plain watch is a work with mode `watch`, adopted as `other`", () => {
    expect(
      says(WORKS, /`watch`/, /`work_adopt`/, /`other`/, /Nothing is asked/),
    ).toBe(true);
  });
});

describe("the wakes", () => {
  const WAKE_TABLE = table(WAKES);

  it("R34–R42: has one row for every wake kind kolu sends, and nothing else", () => {
    const named = WAKE_TABLE.rows.map((row) =>
      (row[0] ?? "").replace(/`/g, ""),
    );
    expect([...named].sort()).toEqual(
      [...ConductorWakeLevelSchema.literals].sort(),
    );
  });

  it("says what happened and what to do for every kind", () => {
    expect(WAKE_TABLE.header).toEqual(["Wake", "What happened", "What you do"]);
    for (const row of WAKE_TABLE.rows)
      expect(
        row.slice(1).every((cell) => cell.length > 0),
        row[0],
      ).toBe(true);
  });

  const row = (kind: string): string =>
    (WAKE_TABLE.rows.find((one) => one[0] === `\`${kind}\``) ?? []).join(" | ");

  it("R34: `ready` is when the brief is said", () => {
    expect(row("ready")).toMatch(/brief/);
  });
  it("R35: `stopped` — read what it did, say what is next", () => {
    expect(row("stopped")).toMatch(/Read what it did/);
  });
  it("R36: `asking` — answer it", () => {
    expect(row("asking")).toMatch(/Answer it/);
  });
  it("R37, R27: `gone` is that terminal, never the work, and never a close of its own", () => {
    expect(row("gone")).toMatch(/Only that terminal/);
    expect(row("gone")).toMatch(/work is still there/);
    expect(row("gone")).toMatch(/close yourself never rings/);
  });
  it("R38: `asleep` stays in its work", () => {
    expect(row("asleep")).toMatch(/stays in its work/);
  });
  it("R39: `exited` — read the screen, expect nothing more", () => {
    expect(row("exited")).toMatch(/Read the screen/);
    expect(row("exited")).toMatch(/Nothing more/);
  });
  it("R40: `ended` — read the screen", () => {
    expect(row("ended")).toMatch(/no agent ever appeared/);
    expect(row("ended")).toMatch(/Read the screen/);
  });
  it("R41: `taken-over` — leave it alone, carry on", () => {
    expect(row("taken-over")).toMatch(/no input, no `agent_say`/);
    expect(row("taken-over")).toMatch(/Carry on/);
  });
  it("R42: `handed-back` — read its screen before acting", () => {
    expect(row("handed-back")).toMatch(/Read its screen before you act/);
  });

  it("R33, R43: a wake names terminals by `host/id`, batches, and rings once per state", () => {
    expect(
      says(
        WAKES,
        /`\[kolu\]`/,
        /`host\/id`/,
        /several terminals/,
        /when the turn ends/,
        /once/,
      ),
    ).toBe(true);
  });

  it("R44, R45, R46: a hand-back is always told; the driver is on the record; only the human takes a terminal back", () => {
    expect(
      says(
        WAKES,
        /always told when a terminal is handed back/,
        /cannot take a terminal back/,
        /`driver`/,
        /`you`/,
        /`conductor`/,
      ),
    ).toBe(true);
  });

  it("R47: no wake carries an exit status, so the screen says how it went", () => {
    expect(
      says(
        WAKES,
        /exit status/,
        /refuses before it starts/,
        /screen/,
        /quiet for a long time/,
      ),
    ).toBe(true);
  });

  it("R48: reads a screen when a wake is not enough, and never polls one", () => {
    expect(says(WAKES, /Read a screen/, /Never poll/)).toBe(true);
  });
});

describe("speaking to agents", () => {
  it("R49, R51, R52: only `agent_say`, no Enter after, read the screen if it did not take, a refusal is an answer", () => {
    expect(
      says(
        SPEAKING,
        /only with `agent_say`/,
        /never send an Enter/,
        /read the screen/,
        /never say the same thing again/,
        /refusal is an answer/,
      ),
    ).toBe(true);
  });

  it("R53: raw typing only at a plain shell — text, a short settle, Enter", () => {
    expect(
      says(
        SPEAKING,
        /plain shell/,
        /`lifecycle_sendInput`/,
        /`wait_outputSettled`/,
        /Enter key/,
        /`run`/,
      ),
    ).toBe(true);
  });

  it("R54, R55: keeps what it says short; long things go through files agents write", () => {
    expect(
      says(
        SPEAKING,
        /short/,
        /one key at a time/,
        /file/,
        /written by an agent/,
        /another host/,
        /results in a file/,
      ),
    ).toBe(true);
  });

  it("R56: questions flow up, and only the human's decisions reach the human", () => {
    expect(
      says(
        SPEAKING,
        /Questions flow up/,
        /from the\s+brief/,
        /tradeoff/,
        /destructive step/,
        /`host\/id`/,
        /what\s+you would do/,
      ),
    ).toBe(true);
  });
});

describe("asking the human", () => {
  it("R57: ask, say what you asked, end your turn — no exception; idle while the human thinks", () => {
    expect(
      says(
        ASKING,
        /Ask, say what you asked, and end your turn/,
        /no exception/,
        /While the human thinks, you are idle, and they can still talk to you\./,
      ),
    ).toBe(true);
  });

  it("R58, R59: the answer is a wake; never wait, poll or ask twice", () => {
    expect(
      says(
        ASKING,
        /arrives as a wake/,
        /who answered/,
        /decline/,
        /restart/,
        /Never wait/,
        /never poll/,
        /never ask the same thing twice/,
      ),
    ).toBe(true);
  });

  it("R61: every choice is a form — `work_ask` or your own question tool, prose only with neither", () => {
    expect(
      says(
        ASKING,
        /Every choice/,
        /form/,
        /`work_ask`/,
        /question tool/,
        /prose only when you have neither/i,
        /Your options/,
      ),
    ).toBe(true);
  });

  it("R62, R64: prose explains, the form asks, and every question has options", () => {
    expect(
      says(
        ASKING,
        /prose explains the choice; the form asks it/i,
        /options/,
        /typed/,
      ),
    ).toBe(true);
  });

  it("governs every turn, so it comes before the waterfall", () => {
    expect(SCRIPT.indexOf("## Asking the human")).toBeLessThan(
      SCRIPT.indexOf("## The waterfall"),
    );
  });
});

describe("the waterfall", () => {
  it("R66, R92: directs a planner and an implementor, in order, ending its turn after each step that starts or asks", () => {
    expect(
      says(
        WATERFALL,
        /never write\s+the code/,
        /planner/,
        /implementor/,
        /in order/,
        /none is optional/,
        /end\s+your turn/,
      ),
    ).toBe(true);
  });

  it("R67: the steps table has one column for each mode the setup can ask between", () => {
    const modes = WORK_MODES.filter((mode) => mode !== "watch").map(
      (mode) => mode[0]?.toUpperCase() + mode.slice(1),
    );
    expect(STEPS.header).toEqual(["Step", ...modes]);
  });

  it("R67: each step exists in both modes, or is marked as the full mode's only", () => {
    const fullOnly = ["Planner", "Approval", "Review rounds"];
    for (const row of STEPS.rows) {
      const [name, full, trivial] = row;
      expect(full, `${name} has no full-mode cell`).toBeTruthy();
      expect(trivial, `${name} has no trivial-mode cell`).toBeTruthy();
      expect(
        trivial === "None.",
        `${name}: only ${fullOnly.join(", ")} are full-only`,
      ).toBe(fullOnly.includes(name ?? ""));
    }
    for (const name of [
      "Open the work",
      "Brief",
      "Implementor",
      "Doubts",
      "Finish",
      "On green",
      "Closing",
    ])
      expect(
        STEPS.rows.some((row) => row[0] === name),
        name,
      ).toBe(true);
  });

  it("R70: asks the setup for every waterfall, never reusing the last silently", () => {
    expect(
      says(
        SETUP,
        /every waterfall/,
        /second one/,
        /last time's answers first/,
        /never reuse/,
      ),
    ).toBe(true);
  });

  it("R71: names every setup key kolu asks, in the one `work_open` call", () => {
    expect(says(SETUP, /one `work_open` call/)).toBe(true);
    for (const key of ["mode", "on-green", ...KOLU_CHOICE_KEYS])
      expect(SETUP).toContain(`\`${key}\``);
  });

  it("R68, R69: the mode is the request's, or asked with a reason; trivial only for settled, small work", () => {
    expect(says(SETUP, /names the mode/, /ask full or trivial/, /why/)).toBe(
      true,
    );
    expect(
      says(
        SETUP,
        /Trivial is for/,
        /settled/,
        /small/,
        /decide for the human is full/,
      ),
    ).toBe(true);
  });

  it("R79, R80, R78: the planner — a fresh worktree; plan and review; plan file; out of git; no question tool", () => {
    const { full } = step("Planner");
    for (const said of [
      /fresh worktree/,
      /`planner`/,
      /On `ready`/,
      /never implement/,
      /never use a question tool/,
      /`\.waterfall\/plan\.md`/,
      /`\.git\/info\/exclude`/,
      /then stop/,
    ])
      expect(full).toMatch(said);
  });

  it("R81: approval — a summary, `work_ask` with the plan as `file`, nothing built before", () => {
    const { full } = step("Approval");
    for (const said of [
      /read the plan/,
      /summary/,
      /`work_ask`/,
      /`file`/,
      /`\.waterfall\/plan\.md`/,
      /ask again/,
      /Nothing is built before approval/,
    ])
      expect(full).toMatch(said);
  });

  it("R82, R84: the brief is the planner's file in full and said aloud in trivial", () => {
    expect(step("Brief").full).toMatch(/`\.waterfall\/brief\.md`/);
    expect(step("Brief").trivial).toMatch(/No brief file/);
  });

  it("R83, R84: the implementor — a split of the planner in full, its own worktree in trivial, briefed on `ready`", () => {
    const { full, trivial } = step("Implementor");
    expect(full).toMatch(/split of the planner/);
    expect(full).toMatch(/`child-of`/);
    expect(full).toMatch(/On `ready`, give it the brief's path/);
    expect(trivial).toMatch(/own fresh worktree/);
    expect(trivial).toMatch(/On `ready`, say the brief/);
  });

  it("R85, R78: the brief carries the rules and the PR's shape, and trivial adds the finish", () => {
    for (const said of [
      /plan/,
      /request in full/,
      /repo's own rules/,
      /never use a question tool/,
      /written\s+for\s+a\s+person,\s+not\s+for\s+an\s+AI/,
      /simple,\s+interesting\s+and\s+never\s+cryptic/,
      /everyday\s+words/,
      /no\s+internal\s+names/,
      /explained\s+once/,
      /title\s+says\s+what\s+changes\s+for\s+the\s+person\s+using\s+it/,
      /a\s+few\s+lines\s+they\s+finish/,
      /Everything\s+else[^;]*comment\s+on\s+the\s+PR/,
      /stop when the PR is open/,
      /refactor pass/,
      /CI/,
    ])
      expect(BRIEF).toMatch(said);
  });

  it("R86: doubts are answered from the plan or the request", () => {
    expect(step("Doubts").full).toMatch(/plan/);
    expect(step("Doubts").trivial).toMatch(/request/);
  });

  it("R87: review rounds — the planner reviews, the implementor addresses, tests once per round", () => {
    const { full } = step("Review rounds");
    for (const said of [
      /planner reviews/,
      /posts the review/,
      /implementor addresses/,
      /repeat/,
      /once per round/,
      /waits for the next/,
    ])
      expect(full).toMatch(said);
  });

  it("R93: review refuses a workaround and asks for the fix at its source", () => {
    const { full } = step("Review rounds");
    for (const said of [/workaround/, /fix/, /source/])
      expect(full).toMatch(said);
  });

  it("R88: the implementor finishes — one refactor pass, then CI once", () => {
    for (const cell of Object.values(step("Finish")).filter(
      (one) => one !== "The same.",
    ))
      for (const said of [
        /implementor/,
        /one final refactor pass/,
        /hickey-lowy/,
        /CI once/,
        /green/,
      ])
        expect(cell).toMatch(said);
  });

  it("R77, R89: on green, merges or hands over as `onGreen` in `works` says", () => {
    expect(step("On green").full).toMatch(/`onGreen`/);
    expect(step("On green").full).toMatch(/not from memory/);
    // Both outcomes the `on-green` decision can hold are named.
    expect(ON_GREEN).toEqual(["merge", "hand-over"]);
    expect(step("On green").full).toMatch(/Merge the PR/);
    expect(step("On green").full).toMatch(/hand it over/);
  });

  it("R90: closes only the terminals it opened, once the PR is merged or closed", () => {
    expect(step("Closing").full).toMatch(/merged or closed/);
    expect(step("Closing").full).toMatch(/planner and the implementor/);
    expect(step("Closing").trivial).toMatch(/implementor, and nothing else/);
  });

  it("R91, R89: the rules it never breaks", () => {
    expect(says(NEVER, /never implement/)).toBe(true);
    expect(says(NEVER, /no new agent/, /no new PR/, /approval/)).toBe(true);
    expect(says(NEVER, /never close an implementor/, /merged or closed/)).toBe(
      true,
    );
    expect(says(NEVER, /your\s+judgement/, /their own repo/)).toBe(true);
  });
});

describe("what reaches the human", () => {
  it("R94: after a wake, the reply's first sentence is the whole news", () => {
    expect(
      says(
        WAKES,
        /After a wake/,
        /first sentence/,
        /whole news/,
        /what, if anything, is wanted/,
        /only when the human must decide/,
      ),
    ).toBe(true);
  });

  it("R95: routine progress is a `work_note` and no reply", () => {
    expect(says(WAKES, /Routine progress/, /`work_note`/, /no reply/)).toBe(
      true,
    );
  });

  it("R96: over to you is always a `work_ask`, never only words", () => {
    expect(
      says(
        ASKING,
        /"Over to you" is always a question/,
        /PR handed over/,
        /`work_ask`/,
        /Never\s+leave it only in a reply or a note/,
      ),
    ).toBe(true);
  });

  it("R97: a message about a work names its id, read in `works`", () => {
    expect(
      says(
        WORKS,
        /`\[kolu\] about`/,
        /`host\/id`/,
        /`\[kolu\] about work “title” \(id\)`/,
        /`works`/,
      ),
    ).toBe(true);
  });
});
