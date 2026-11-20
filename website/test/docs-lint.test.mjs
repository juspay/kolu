import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const fromMdx = createRequire(
  createRequire(import.meta.url).resolve("@astrojs/mdx/package.json"),
);
const load = async (name) => import(pathToFileURL(fromMdx.resolve(name)).href);
const { unified } = await load("unified");
const { default: remarkParse } = await load("remark-parse");
const { default: remarkMdx } = await load("remark-mdx");
const { default: remarkGfm } = await load("remark-gfm");
const YAML = await load("yaml");

const LIMITS = {
  blockWords: 80,
  cellWords: 40,
  sectionWords: 300,
  pageWords: 2500,
  sentenceWords: 40,
  dashesPerSentence: 1,
  semicolonsPerSentence: 1,
  descriptionChars: 160,
};

const COLLECTIONS = ["docs", "surface"];
const contentDir = (c) => new URL(`../src/content/${c}/`, import.meta.url);

const parser = unified().use(remarkParse).use(remarkMdx).use(remarkGfm);
const sentences = new Intl.Segmenter("en", { granularity: "sentence" });

function splitFrontmatter(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(source);
  if (!match) throw new Error("page has no frontmatter");
  const offset = match[0].split("\n").length - 1;
  return {
    data: YAML.parse(match[1]),
    body: source.slice(match[0].length),
    offset,
  };
}

const CODE_WORD_TOKEN = "X";

function runningTextOf(node) {
  if (node.type === "inlineCode")
    return node.value
      .split(/\s+/)
      .filter(Boolean)
      .map(() => CODE_WORD_TOKEN)
      .join(" ");
  if (node.type === "text") return node.value;
  if (node.type === "break") return " ";
  if (
    node.type === "image" ||
    node.type === "mdxTextExpression" ||
    node.type === "mdxFlowExpression"
  )
    return "";
  if (!node.children) return "";
  return node.children.map(runningTextOf).join("");
}

const words = (text) =>
  text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

// "kolu" is written lower case even at the start of a sentence (house style),
// which the segmenter would read as a continuation, so it segments a copy with
// the word capitalised. Word counts are unaffected.
function sentencesOf(text) {
  const flat = text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\bkolu\b/g, "Kolu");
  return [...sentences.segment(flat)]
    .map((s) => s.segment.trim())
    .filter(Boolean);
}

const isSvg = (node) =>
  (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") &&
  node.name === "svg";
const isSteps = (node) =>
  node.type === "mdxJsxFlowElement" && node.name === "Steps";

function lintPage({ data, body, offset }, { reference }) {
  const problems = [];
  const at = (node) =>
    node.position ? node.position.start.line + offset : "?";
  const report = (node, message) =>
    problems.push(`line ${at(node)}: ${message}`);

  const description = data?.description;
  if (typeof description !== "string" || description.trim() === "") {
    problems.push("frontmatter: description is missing");
  } else {
    if (description.length > LIMITS.descriptionChars)
      problems.push(
        `frontmatter: description is ${description.length} characters (limit ${LIMITS.descriptionChars})`,
      );
    if (sentencesOf(description).length > 1)
      problems.push("frontmatter: description is more than one sentence");
  }

  const checkSentences = (node, text) => {
    for (const s of sentencesOf(text)) {
      const n = words(s);
      const excerpt = s.length > 70 ? `${s.slice(0, 70)}…` : s;
      if (n > LIMITS.sentenceWords)
        report(
          node,
          `sentence of ${n} words (limit ${LIMITS.sentenceWords}): "${excerpt}"`,
        );
      const dashes = (s.match(/—|--/g) ?? []).length;
      if (dashes > LIMITS.dashesPerSentence)
        report(
          node,
          `sentence with ${dashes} em-dashes (limit ${LIMITS.dashesPerSentence}): "${excerpt}"`,
        );
      const semis = (s.match(/;/g) ?? []).length;
      if (semis > LIMITS.semicolonsPerSentence)
        report(
          node,
          `sentence with ${semis} semicolons (limit ${LIMITS.semicolonsPerSentence}): "${excerpt}"`,
        );
    }
  };

  let pageWords = 0;
  let section = {
    title: "(opening, before the first heading)",
    node: null,
    words: 0,
  };
  const closeSection = () => {
    if (section.words > LIMITS.sectionWords)
      problems.push(
        `line ${section.node ? at(section.node) : offset + 1}: ${section.words} words of running text under "${section.title}" (limit ${LIMITS.sectionWords})`,
      );
  };

  const block = (node, text, inSteps) => {
    const n = words(text);
    pageWords += n;
    if (!inSteps) section.words += n;
    if (n > LIMITS.blockWords)
      report(
        node,
        `${node.type === "listItem" ? "list item" : "paragraph"} of ${n} words (limit ${LIMITS.blockWords})`,
      );
    checkSentences(node, text);
  };

  const walk = (node, inSteps) => {
    if (isSvg(node) || node.type === "code" || node.type === "mdxjsEsm") return;
    switch (node.type) {
      case "heading": {
        closeSection();
        const title = runningTextOf(node).trim();
        section = { title, node, words: 0 };
        pageWords += words(title);
        checkSentences(node, title);
        return;
      }
      case "paragraph": {
        if (node.children[0]?.type === "strong")
          report(
            node,
            "paragraph opens with a bold run-in — use a heading, a list or a table",
          );
        block(node, runningTextOf(node), inSteps);
        return;
      }
      case "listItem": {
        const isParagraph = (c) => c.type === "paragraph";
        const text = node.children
          .filter(isParagraph)
          .map(runningTextOf)
          .join(" ");
        block(node, text, inSteps);
        for (const child of node.children)
          if (!isParagraph(child)) walk(child, inSteps);
        return;
      }
      case "table": {
        for (const row of node.children)
          for (const cell of row.children) {
            const text = runningTextOf(cell);
            const n = words(text);
            pageWords += n;
            if (n > LIMITS.cellWords)
              report(
                cell,
                `table cell of ${n} words (limit ${LIMITS.cellWords})`,
              );
            checkSentences(cell, text);
          }
        return;
      }
      default: {
        for (const child of node.children ?? [])
          walk(child, inSteps || isSteps(node));
      }
    }
  };

  walk(parser.parse(body), false);
  closeSection();

  if (!reference && pageWords > LIMITS.pageWords)
    problems.push(
      `page: ${pageWords} words of running text (limit ${LIMITS.pageWords})`,
    );

  return problems;
}

for (const collection of COLLECTIONS) {
  const dir = contentDir(collection);
  const files = readdirSync(dir)
    .filter((f) => /\.mdx?$/.test(f))
    .sort();
  for (const file of files) {
    const slug = file.replace(/\.mdx?$/, "");
    test(`${collection}/${slug}`, () => {
      const page = splitFrontmatter(
        readFileSync(fileURLToPath(new URL(file, dir)), "utf8"),
      );
      const reference =
        collection === "surface" &&
        /Reference$/.test(String(page.data?.section ?? ""));
      const problems = lintPage(page, { reference });
      assert.deepEqual(
        problems,
        [],
        `${collection}/${file} breaks the writing standard (dev/skills/docs-writing/SKILL.md):\n  ${problems.join("\n  ")}`,
      );
    });
  }
}
