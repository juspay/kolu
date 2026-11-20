import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import GithubSlugger from "github-slugger";
import { toString as mdastToString } from "mdast-util-to-string";
import type { Link, Nodes, Root } from "mdast";
import type {
  MdxJsxAttribute,
  MdxJsxFlowElement,
  MdxJsxTextElement,
} from "mdast-util-mdx-jsx";
import { visit } from "unist-util-visit";
import {
  CHANGE_KINDS,
  type ChangeKind,
  type ChangelogStat,
  changelogReleaseKey,
  isChangeKind,
} from "./changelog";

interface AstroFileData {
  astro?: { frontmatter?: Record<string, unknown> };
}

type MdxElement = MdxJsxFlowElement | MdxJsxTextElement;

const isChangeElement = (node: Nodes): node is MdxElement =>
  (node.type === "mdxJsxTextElement" || node.type === "mdxJsxFlowElement") &&
  node.name === "Change";

const changeKind = (node: Nodes): ChangeKind | undefined => {
  if (!isChangeElement(node)) return undefined;

  const kindAttribute = node.attributes.find(
    (attribute): attribute is MdxJsxAttribute =>
      attribute.type === "mdxJsxAttribute" && attribute.name === "kind",
  );
  const value = kindAttribute?.value;
  if (!isChangeKind(value))
    throw new Error(
      `<Change> requires a known string \`kind\`, received ${String(value)}`,
    );
  return value;
};

const typedStats = (tree: Root): ChangelogStat[] => {
  const counts = Object.fromEntries(
    CHANGE_KINDS.map(({ key }) => [key, 0]),
  ) as Record<ChangeKind, number>;

  visit(tree, (node) => {
    const kind = changeKind(node);
    if (kind) counts[kind] += 1;
  });

  return CHANGE_KINDS.map(({ key, label }) => ({
    key,
    label,
    count: counts[key],
  })).filter(({ count }) => count > 0);
};

const headingStats = (tree: Root): ChangelogStat[] => {
  const stats: ChangelogStat[] = [];
  const slugger = new GithubSlugger();
  let active: ChangelogStat | undefined;

  for (const node of tree.children) {
    if (node.type === "heading" && node.depth === 3) {
      const label = mdastToString(node).trim();
      active = { label, key: slugger.slug(label), count: 0 };
      stats.push(active);
    } else if (node.type === "list" && active) {
      active.count += node.children.length;
    }
  }

  return stats;
};

const HEADINGS_WITHOUT_PRODUCT_AREA = new Set([
  "Before you update",
  "Performance",
]);

interface ProductAreaTarget {
  route: string;
  anchor: string | undefined;
}

const productAreaTarget = (link: Link): ProductAreaTarget => {
  const [route, anchor] = (
    link.url.startsWith("/") ? link.url.slice(1) : ""
  ).split("#");
  return { route, anchor };
};

const validateLedger = (tree: Root, srcDir: string) => {
  const pageCandidates = (slug: string) =>
    [
      `content/docs/${slug}.mdx`,
      `content/docs/${slug}.md`,
      `pages/${slug}.astro`,
      `pages/${slug}/index.astro`,
    ].map((candidate) => resolve(srcDir, candidate));

  const pageExists = (slug: string) =>
    pageCandidates(slug).some((candidate) => existsSync(candidate));

  const renderedAnchorsOf = (slug: string): Set<string> => {
    const file = pageCandidates(slug).find((c) => existsSync(c));
    const body = file === undefined ? "" : readFileSync(file, "utf8");
    const slugger = new GithubSlugger();
    const slugs = new Set<string>();
    for (const line of body.split("\n")) {
      const heading = /^#{2,4}\s+(.*)$/.exec(line);
      if (!heading) continue;
      const text = heading[1]
        .replace(/`/g, "")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/[*_]/g, "")
        .trim();
      slugs.add(slugger.slug(text));
    }
    return slugs;
  };

  let sawHeading = false;
  for (const node of tree.children) {
    if (node.type === "heading" && node.depth === 3) {
      sawHeading = true;
      const label = mdastToString(node).trim();
      const link: Link | undefined =
        node.children.length === 1 && node.children[0].type === "link"
          ? node.children[0]
          : undefined;
      if (!link) {
        if (!HEADINGS_WITHOUT_PRODUCT_AREA.has(label))
          throw new Error(
            `Changelog heading "${label}" must link its product area to a docs page, e.g. \`### [The Dock](/dock)\``,
          );
        continue;
      }
      const { route, anchor } = productAreaTarget(link);
      if (!route || !/^[a-z0-9-]+$/.test(route) || !pageExists(route))
        throw new Error(
          `Changelog heading "${label}" links to "${link.url}", but no page exists at that route (checked src/content/docs/ and src/pages/)`,
        );
      if (anchor !== undefined && !renderedAnchorsOf(route).has(anchor))
        throw new Error(
          `Changelog heading "${label}" links to "${link.url}", but "/${route}" has no heading that produces the anchor "#${anchor}"`,
        );
    } else if (node.type === "list" && !sawHeading) {
      let orphan: string | undefined;
      visit(node, (child) => {
        if (!orphan && isChangeElement(child))
          orphan = mdastToString(child).slice(0, 60);
      });
      if (orphan !== undefined)
        throw new Error(
          `A changelog <Change> entry ("${orphan}…") appears before any product-area ### heading`,
        );
    }
  }
};

export function remarkChangelog() {
  return (tree: Root, file: { path?: string; data: AstroFileData }) => {
    const frontmatter = file.data.astro?.frontmatter;
    if (!frontmatter || typeof frontmatter.version !== "string") return;
    const version = frontmatter.version;

    const headingSlugger = new GithubSlugger();
    const prefix = changelogReleaseKey(version);
    visit(tree, "heading", (node) => {
      const id = `${prefix}-${headingSlugger.slug(mdastToString(node))}`;
      node.data ??= {};
      node.data.hProperties = { ...node.data.hProperties, id };
    });

    const kinds = typedStats(tree);
    if (kinds.length > 0) {
      if (!file.path)
        throw new Error(
          "remarkChangelog needs the file path to validate headings",
        );
      validateLedger(tree, resolve(dirname(file.path), "../.."));
    }
    frontmatter.changelogStats = kinds.length > 0 ? kinds : headingStats(tree);
  };
}
