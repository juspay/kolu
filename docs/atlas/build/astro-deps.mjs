// One resolver for the astro-transitive packages the build tests pin against
// (shiki, @astrojs/markdown-remark, @astrojs/internal-helpers) — both test
// files share this so the createRequire-through-astro dance exists once per
// project. The packages are transitive deps (of `astro`), so they resolve
// through astro's own require context — version-agnostic, unlike a .pnpm
// store path.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const requireFromAstro = createRequire(
  createRequire(import.meta.url).resolve("astro/package.json"),
);

const importResolved = (resolver, specifier) =>
  import(pathToFileURL(resolver.resolve(specifier)).href);

/** The installed `shiki` module (createHighlighter, bundledLanguages, isSpecialLang, …). */
export const shiki = await importResolved(requireFromAstro, "shiki");

/** The installed `@astrojs/markdown-remark` (createMarkdownProcessor, …). */
export const astroMarkdownRemark = await importResolved(
  requireFromAstro,
  "@astrojs/markdown-remark",
);

/** astro's own createShikiHighlighter — the exact path the build uses. */
export const { createShikiHighlighter } = await importResolved(
  requireFromAstro,
  "@astrojs/markdown-remark/shiki",
);

/** @astrojs/internal-helpers/markdown (defaultExcludeLanguages) — anchored on
 * markdown-remark's resolved entry file (the package doesn't export
 * ./package.json). */
export const astroMarkdown = await importResolved(
  createRequire(requireFromAstro.resolve("@astrojs/markdown-remark")),
  "@astrojs/internal-helpers/markdown",
);
