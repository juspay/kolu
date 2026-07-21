import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$Issue } from "./Issue_mLFqCJSR.mjs";
import { t as $$Svg } from "./Svg_DjauMHvD.mjs";
import { t as $$Footnote } from "./Footnote_D9yrIxmz.mjs";
//#region src/diagrams/nix-without-github-layers.svg?raw
var nix_without_github_layers_default = "<svg viewBox=\"0 0 940 400\" xmlns=\"http://www.w3.org/2000/svg\" font-family=\"ui-sans-serif, system-ui, sans-serif\" font-size=\"12.5\">\n  <defs>\n    <marker id=\"ar\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M0 0 L10 5 L0 10 z\" fill=\"#5b6472\"/>\n    </marker>\n    <marker id=\"arR\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M0 0 L10 5 L0 10 z\" fill=\"#c0392b\"/>\n    </marker>\n    <marker id=\"arG\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M0 0 L10 5 L0 10 z\" fill=\"#2e7d4f\"/>\n    </marker>\n  </defs>\n\n  <style>\n    .box{rx:9;ry:9;stroke-width:1.6}\n    .safe{fill:#e3f6e9;stroke:#2e7d4f}\n    .bad{fill:#fbe2e2;stroke:#c0392b}\n    .host{fill:#e9eefb;stroke:#5a6fa0}\n    .cache{fill:#fff3d4;stroke:#b8860b}\n    .t{fill:#1c2430}\n    .sub{fill:#5b6472;font-size:11px}\n    .subG{fill:#2e7d4f;font-size:11px;font-weight:600}\n    .subR{fill:#c0392b;font-size:11px;font-weight:600}\n    .h{font-weight:700}\n  </style>\n\n  <!-- Row A: the already-pinned path -->\n  <rect class=\"box safe\" x=\"16\"  y=\"30\" width=\"176\" height=\"56\"/>\n  <text class=\"t h\" x=\"104\" y=\"53\" text-anchor=\"middle\">kolu flake.nix</text>\n  <text class=\"sub\" x=\"104\" y=\"70\" text-anchor=\"middle\">ZERO inputs — by design</text>\n\n  <rect class=\"box safe\" x=\"256\" y=\"30\" width=\"176\" height=\"56\"/>\n  <text class=\"t h\" x=\"344\" y=\"53\" text-anchor=\"middle\">npins</text>\n  <text class=\"sub\" x=\"344\" y=\"70\" text-anchor=\"middle\">sources.json · rev + narHash</text>\n\n  <rect class=\"box host\" x=\"496\" y=\"30\" width=\"176\" height=\"56\"/>\n  <text class=\"t h\" x=\"584\" y=\"53\" text-anchor=\"middle\">codeload.github.com</text>\n  <text class=\"sub\" x=\"584\" y=\"70\" text-anchor=\"middle\">archive tarballs (no API)</text>\n\n  <rect class=\"box cache\" x=\"736\" y=\"30\" width=\"188\" height=\"56\"/>\n  <text class=\"t h\" x=\"830\" y=\"49\" text-anchor=\"middle\">Binary cache</text>\n  <text class=\"sub\" x=\"830\" y=\"65\" text-anchor=\"middle\">cache.nixos.asia/oss</text>\n  <text class=\"sub\" x=\"830\" y=\"79\" text-anchor=\"middle\">— the lever —</text>\n\n  <line x1=\"192\" y1=\"58\" x2=\"252\" y2=\"58\" stroke=\"#2e7d4f\" stroke-width=\"1.6\" marker-end=\"url(#arG)\"/>\n  <line x1=\"432\" y1=\"58\" x2=\"492\" y2=\"58\" stroke=\"#2e7d4f\" stroke-width=\"1.6\" marker-end=\"url(#arG)\"/>\n  <text class=\"subG\" x=\"462\" y=\"50\" text-anchor=\"middle\">rev tarball</text>\n  <line x1=\"672\" y1=\"58\" x2=\"732\" y2=\"58\" stroke=\"#5b6472\" stroke-width=\"1.6\" marker-end=\"url(#ar)\"/>\n\n  <!-- cache substitutes back into the build (dashed, the escape from GitHub) -->\n  <path d=\"M830 86 C 830 150, 104 150, 104 90\" fill=\"none\" stroke=\"#b8860b\" stroke-width=\"1.6\" stroke-dasharray=\"6 4\" marker-end=\"url(#ar)\"/>\n  <text class=\"sub\" x=\"467\" y=\"145\" text-anchor=\"middle\" fill=\"#b8860b\">substitute the built closure — no source fetch reaches GitHub</text>\n\n  <!-- Row B: the residual API hole -->\n  <rect class=\"box safe\" x=\"16\"  y=\"214\" width=\"176\" height=\"56\"/>\n  <text class=\"t h\" x=\"104\" y=\"237\" text-anchor=\"middle\">ci::nix / ci::home-manager</text>\n  <text class=\"sub\" x=\"104\" y=\"254\" text-anchor=\"middle\">ci/mod.just:101,120</text>\n\n  <rect class=\"box safe\" x=\"256\" y=\"214\" width=\"176\" height=\"56\"/>\n  <text class=\"t h\" x=\"344\" y=\"237\" text-anchor=\"middle\">devour-flake</text>\n  <text class=\"sub\" x=\"344\" y=\"254\" text-anchor=\"middle\">PINNED to a rev · #1917</text>\n\n  <rect class=\"box bad\" x=\"496\" y=\"300\" width=\"196\" height=\"56\"/>\n  <text class=\"t h\" x=\"594\" y=\"323\" text-anchor=\"middle\">nixpkgs-unstable</text>\n  <text class=\"sub\" x=\"594\" y=\"340\" text-anchor=\"middle\">UNPINNED branch ref</text>\n\n  <rect class=\"box bad\" x=\"736\" y=\"300\" width=\"188\" height=\"56\"/>\n  <text class=\"t h\" x=\"830\" y=\"323\" text-anchor=\"middle\">api.github.com</text>\n  <text class=\"sub\" x=\"830\" y=\"340\" text-anchor=\"middle\">REST · 60/hr anon → 403</text>\n\n  <line x1=\"192\" y1=\"242\" x2=\"252\" y2=\"242\" stroke=\"#2e7d4f\" stroke-width=\"1.6\" marker-end=\"url(#arG)\"/>\n  <!-- devour → codeload (pinned, safe, goes up-right) -->\n  <path d=\"M432 232 C 470 210, 470 70, 494 62\" fill=\"none\" stroke=\"#2e7d4f\" stroke-width=\"1.6\" marker-end=\"url(#arG)\"/>\n  <text class=\"subG\" x=\"470\" y=\"180\" text-anchor=\"middle\">pinned rev → codeload</text>\n  <!-- devour → transitive (the override re-resolve, red) -->\n  <path d=\"M370 270 C 400 300, 460 322, 492 328\" fill=\"none\" stroke=\"#c0392b\" stroke-width=\"1.6\" marker-end=\"url(#arR)\"/>\n  <text class=\"subR\" x=\"392\" y=\"312\" text-anchor=\"middle\">--override-input re-resolves</text>\n  <!-- transitive → api (red) -->\n  <line x1=\"692\" y1=\"328\" x2=\"732\" y2=\"328\" stroke=\"#c0392b\" stroke-width=\"1.6\" marker-end=\"url(#arR)\"/>\n  <text class=\"subR\" x=\"712\" y=\"320\" text-anchor=\"middle\">resolve HEAD</text>\n\n  <!-- legend -->\n  <g transform=\"translate(16,372)\">\n    <rect x=\"0\" y=\"-9\" width=\"13\" height=\"13\" class=\"box safe\"/><text class=\"sub\" x=\"19\" y=\"1\">pinned — no API</text>\n    <rect x=\"150\" y=\"-9\" width=\"13\" height=\"13\" class=\"box bad\"/><text class=\"sub\" x=\"169\" y=\"1\">live REST API (rate-limited)</text>\n    <rect x=\"360\" y=\"-9\" width=\"13\" height=\"13\" class=\"box host\"/><text class=\"sub\" x=\"379\" y=\"1\">source host</text>\n    <rect x=\"480\" y=\"-9\" width=\"13\" height=\"13\" class=\"box cache\"/><text class=\"sub\" x=\"499\" y=\"1\">binary cache — the lever</text>\n  </g>\n</svg>\n";
//#endregion
//#region src/content/atlas/nix-without-github.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		code: "code",
		em: "em",
		h2: "h2",
		h3: "h3",
		p: "p",
		strong: "strong",
		table: "table",
		tbody: "tbody",
		td: "td",
		th: "th",
		thead: "thead",
		tr: "tr"
	}, props.components);
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: [
			"A night of CI kept dying on GitHub: an unauthenticated ",
			createVNode(_components.code, { children: "api.github.com" }),
			" call\nhit its 60-request/hour ceiling on a shared CI egress IP and 403’d\n",
			createVNode(_components.code, { children: "ci::nix" }),
			"/",
			createVNode(_components.code, { children: "ci::home-manager" }),
			" across every cold pool box.",
			createVNode($$Footnote, { children: [
				"2026-07-21. The\npool’s shared egress IP ",
				createVNode(_components.code, { children: "219.65.110.2" }),
				" exhausted the anonymous GitHub REST limit;\na leased box read “healthy” (it probes the Nix cache, not GitHub) yet 403’d the\nmoment Nix’s fetcher resolved a ",
				createVNode(_components.code, { children: "github:" }),
				" ref. Tracked in ",
				createVNode($$Issue, { n: 1204 }),
				"."
			] }),
			"\nThe reflex fix is “add a token.” The better question is the one that removes the\nfailure class: ",
			createVNode(_components.strong, { children: "what does it take for a kolu build to not touch GitHub at all?" })
		] }),
		"\n",
		createVNode(_components.p, { children: "The good news is that kolu is already most of the way there — by deliberate\ndesign decisions that predate this incident. The gap is small and nameable." }),
		"\n",
		createVNode(_components.h2, {
			id: "the-four-layers-of-github-dependency",
			children: "The four layers of GitHub dependency"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"“Depending on GitHub” is not one thing. A Nix build touches GitHub in up to four\ndistinct ways, each with a different failure mode and a different fix. Tonight’s\noutage was ",
			createVNode(_components.strong, { children: "only the first" }),
			" — the one kolu is closest to eliminating."
		] }),
		"\n",
		createVNode($$Svg, {
			svg: nix_without_github_layers_default,
			wide: true,
			caption: "Where a kolu build reaches GitHub today. Green = already pinned to an immutable value (no live API call). Red = the one residual live dependency (a transitive unpinned ref inside devour-flake). The binary cache (gold) is the lever that makes every source fetch optional."
		}),
		"\n",
		createVNode(_components.h3, {
			id: "the-rest-api-layer-1--tonights-outage",
			children: "The REST API (Layer 1 — tonight’s outage)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Nix resolves an ",
			createVNode(_components.strong, { children: "unpinned" }),
			" ",
			createVNode(_components.code, { children: "github:owner/repo" }),
			" ref by asking\n",
			createVNode(_components.code, { children: "api.github.com/repos/owner/repo/commits/HEAD" }),
			" for the current revision — the\nrate-limited call. A ref ",
			createVNode(_components.strong, { children: "pinned to a full 40-hex commit SHA" }),
			" skips that call\nentirely and pulls the tarball from ",
			createVNode(_components.code, { children: "codeload.github.com" }),
			" instead, which is not\nthe rate-limited API.",
			createVNode($$Footnote, { children: [
				"Verified by an empty-store ",
				createVNode(_components.code, { children: "nix build … -vvvv" }),
				"\ntrace during ",
				createVNode($$PrLink, { pr: 1917 }),
				": a rev-pinned ",
				createVNode(_components.code, { children: "github:" }),
				" ref made zero\n",
				createVNode(_components.code, { children: "api.github.com" }),
				" requests; an unpinned one made the HEAD-resolution call that\n403’d. This is why ",
				createVNode($$PrLink, { pr: 1917 }),
				" — pinning ",
				createVNode(_components.code, { children: "devour-flake" }),
				" to a rev — was\nthe right instinct, and why a full SHA (not a branch/tag) is load-bearing."
			] })
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "kolu’s own builds already make no REST-API calls." }),
			" The flake has ",
			createVNode(_components.em, { children: "zero\ninputs" }),
			" on purpose,",
			createVNode($$Footnote, { children: [
				"Documented in ",
				createVNode(_components.code, { children: "flake.nix" }),
				": each flake input adds\n~1.5s of fetcher-cache verification to a cold ",
				createVNode(_components.code, { children: "nix develop" }),
				", so nixpkgs is\nimported via npins in ",
				createVNode(_components.code, { children: "nix/nixpkgs.nix" }),
				" rather than as a flake input. The perf\ndecision bought API-independence for free."
			] }),
			" and every external source\nis pinned by rev ",
			createVNode(_components.strong, { children: "and" }),
			" ",
			createVNode(_components.code, { children: "narHash" }),
			" through ",
			createVNode(_components.strong, { children: "npins" }),
			" (",
			createVNode(_components.code, { children: "npins/sources.json" }),
			" —\n",
			createVNode(_components.code, { children: "nixpkgs" }),
			", ",
			createVNode(_components.code, { children: "odu" }),
			", colour schemes). npins resolves nothing at build time; it\nfetches an immutable tarball."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The single residual REST call is ",
			createVNode(_components.strong, { children: "not kolu’s" }),
			" — it is ",
			createVNode(_components.em, { children: "inside" }),
			" ",
			createVNode(_components.code, { children: "devour-flake" }),
			".\n",
			createVNode(_components.code, { children: "ci::home-manager" }),
			" passes ",
			createVNode(_components.code, { children: "--override-input flake/kolu ." }),
			", which forces Nix to\nre-resolve ",
			createVNode(_components.code, { children: "devour-flake" }),
			"’s own lockfile, and ",
			createVNode(_components.code, { children: "devour-flake" }),
			" pins its ",
			createVNode(_components.code, { children: "nixpkgs" }),
			"\nto the ",
			createVNode(_components.strong, { children: "unpinned branch" }),
			" ",
			createVNode(_components.code, { children: "github:nixos/nixpkgs/nixpkgs-unstable" }),
			" — so that\nbranch’s HEAD is resolved via the REST API."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "github-as-a-source-host-layer-2",
			children: "GitHub as a source host (Layer 2)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Even with every ref pinned, the ",
			createVNode(_components.em, { children: "tarballs" }),
			" still come from ",
			createVNode(_components.code, { children: "codeload.github.com" }),
			".\nA build only reaches it when the ",
			createVNode(_components.strong, { children: "binary cache misses" }),
			" — a cold box with an\nempty store. A warm box, or any box whose substituter already holds the built\nclosure, never fetches source from GitHub at all."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "github-as-the-code-of-truth-layer-3",
			children: "GitHub as the code-of-truth (Layer 3)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The repository itself (and ",
			createVNode(_components.code, { children: "odu" }),
			") live on GitHub; remote CI lanes ",
			createVNode(_components.code, { children: "git fetch" }),
			" the\npushed SHA. Removing this means self-hosting a forge mirror — a larger\norganizational move, named here for completeness but out of scope for the Nix\nlayer."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "the-binary-cache-is-the-real-lever-layer-4",
			children: "The binary cache is the real lever (Layer 4)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The cache — ",
			createVNode(_components.code, { children: "cache.nixos.asia/oss" }),
			" (kolu’s ",
			createVNode(_components.code, { children: "nixConfig" }),
			" substituter) plus Nix’s\ndefault ",
			createVNode(_components.code, { children: "cache.nixos.org" }),
			" — is ",
			createVNode(_components.strong, { children: "not GitHub" }),
			", but it ",
			createVNode(_components.em, { children: "is" }),
			" the dependency that\nactually decides whether a build touches GitHub. If the cache holds the complete\nclosure, Layers 1–2 never fire. Tonight’s ",
			createVNode(_components.em, { children: "second" }),
			" failure proves the point: a\ncold box’s ",
			createVNode(_components.code, { children: "ci::nix" }),
			" also stalled on ",
			createVNode(_components.code, { children: "cache.nixos.org" }),
			" egress (",
			createVNode(_components.code, { children: "<1 byte/sec for 300s" }),
			") — a cache-CDN fault that has nothing to do with GitHub and that a complete,\nreliable private cache would have absorbed."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-plan",
			children: "The plan"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Three moves, independent, in leverage order. ",
			createVNode(_components.code, { children: "GH1" }),
			" is a one-line change that\ncloses tonight’s exact failure; ",
			createVNode(_components.code, { children: "GH2" }),
			" is the durable fix; ",
			createVNode(_components.code, { children: "GH3" }),
			" is the optional\nend-state."
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Id" }),
					"\n",
					createVNode(_components.th, { children: "Move" }),
					"\n",
					createVNode(_components.th, { children: "What it removes" }),
					"\n",
					createVNode(_components.th, { children: "Size" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "GH1" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"Pin ",
						createVNode(_components.code, { children: "devour-flake" }),
						"’s transitive nixpkgs"
					] }),
					"\n",
					createVNode(_components.td, { children: "The last live REST-API call → the 403 class" }),
					"\n",
					createVNode(_components.td, { children: "One recipe flag" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "GH2" }) }),
					"\n",
					createVNode(_components.td, { children: "Complete + primary private binary cache" }),
					"\n",
					createVNode(_components.td, { children: [
						"Every source fetch to GitHub (Layers 1–2) ",
						createVNode(_components.em, { children: "and" }),
						" the ",
						createVNode(_components.code, { children: "cache.nixos.org" }),
						" egress fragility"
					] }),
					"\n",
					createVNode(_components.td, { children: "Infra" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "GH3" }) }),
					"\n",
					createVNode(_components.td, { children: "Self-hosted forge + source mirror" }),
					"\n",
					createVNode(_components.td, { children: "GitHub as source host & code-of-truth (Layer 3)" }),
					"\n",
					createVNode(_components.td, { children: "Org-level" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "gh1--close-the-transitive-rest-call",
			children: "GH1 — close the transitive REST call"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "ci::nix" }),
			" and ",
			createVNode(_components.code, { children: "ci::home-manager" }),
			" already override ",
			createVNode(_components.code, { children: "devour-flake" }),
			"’s ",
			createVNode(_components.code, { children: "flake" }),
			" input\n(",
			createVNode(_components.code, { children: "ci/mod.just:101,120" }),
			"). Add a second override so ",
			createVNode(_components.code, { children: "devour-flake" }),
			"‘s ",
			createVNode(_components.code, { children: "nixpkgs" }),
			"\nresolves to kolu’s ",
			createVNode(_components.strong, { children: "already-pinned" }),
			" npins nixpkgs rev instead of the unpinned\n",
			createVNode(_components.code, { children: "nixpkgs-unstable" }),
			" branch — e.g. ",
			createVNode(_components.code, { children: "--override-input nixpkgs <pinned>" }),
			".",
			createVNode($$Footnote, { children: [
				"The\nexact input name (",
				createVNode(_components.code, { children: "nixpkgs" }),
				") should be confirmed against ",
				createVNode(_components.code, { children: "nix flake metadata github:srid/devour-flake" }),
				" before writing the flag; the mechanism is the point.\nAn alternative is a token in the CI boxes’ ",
				createVNode(_components.code, { children: "nix.conf" }),
				" (",
				createVNode(_components.code, { children: "access-tokens = github.com=…" }),
				"), which raises the anon limit — but it ",
				createVNode(_components.em, { children: "mitigates" }),
				" rather than\n",
				createVNode(_components.em, { children: "eliminates" }),
				" the dependency, and provisions a secret onto shared boxes, so it is\nthe weaker option."
			] }),
			" Net: zero ",
			createVNode(_components.code, { children: "api.github.com" }),
			" calls in CI. This is the\ncheapest move and it directly retires ",
			createVNode($$Issue, { n: 1204 }),
			"’s failure class."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "gh2--make-the-private-cache-complete-and-authoritative",
			children: "GH2 — make the private cache complete and authoritative"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The binary cache is what makes GitHub optional. To get there: ensure every CI\nbuild ",
			createVNode(_components.strong, { children: "pushes" }),
			" its outputs to ",
			createVNode(_components.code, { children: "cache.nixos.asia/oss" }),
			" for every platform, so a\ncold box substitutes the full closure instead of source-building; and treat that\ncache as primary so a ",
			createVNode(_components.code, { children: "cache.nixos.org" }),
			" hiccup can’t stall a lane. A warm,\ncomplete, self-owned cache collapses Layers 1 and 2 to a cold-start fallback and\nremoves the CDN-egress fragility in one stroke — the highest-leverage move here."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "gh3--self-host-the-forge-optional-end-state",
			children: "GH3 — self-host the forge (optional end-state)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Only self-hosting the git forge (and mirroring the npins/",
			createVNode(_components.code, { children: "devour-flake" }),
			" sources\nto it or to the cache) removes GitHub as the source-of-truth and the CI trigger.\nThis is an organizational decision beyond the Nix layer; it is the ",
			createVNode(_components.em, { children: "only" }),
			" piece\nthat makes the dependency literally zero, and it is not required to end the\nincident class — GH1 + GH2 already do that."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "The one-line takeaway",
			children: createVNode(_components.p, { children: [
				"kolu already makes ",
				createVNode(_components.strong, { children: "no GitHub REST calls of its own" }),
				" — zero flake inputs plus\nnpins rev-pinning bought that. The remaining GitHub dependence is one\nunpinned transitive ref (",
				createVNode(_components.strong, { children: "GH1" }),
				", a one-line fix) and source-fetch on a cache\nmiss (",
				createVNode(_components.strong, { children: "GH2" }),
				", a complete private cache). The lever is the ",
				createVNode(_components.strong, { children: "binary cache" }),
				",\nnot GitHub itself."
			] })
		})
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "Nix Without GitHub",
	"description": "How kolu's Nix builds can stop depending on GitHub — the four dependency layers, why we're already most of the way there, and the small moves that close the gap.",
	"parents": ["analysis"],
	"status": "proposed",
	"maturity": "seedling",
	"updated": "2026-07-21T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "the-four-layers-of-github-dependency",
			"text": "The four layers of GitHub dependency"
		},
		{
			"depth": 3,
			"slug": "the-rest-api-layer-1--tonights-outage",
			"text": "The REST API (Layer 1 — tonight’s outage)"
		},
		{
			"depth": 3,
			"slug": "github-as-a-source-host-layer-2",
			"text": "GitHub as a source host (Layer 2)"
		},
		{
			"depth": 3,
			"slug": "github-as-the-code-of-truth-layer-3",
			"text": "GitHub as the code-of-truth (Layer 3)"
		},
		{
			"depth": 3,
			"slug": "the-binary-cache-is-the-real-lever-layer-4",
			"text": "The binary cache is the real lever (Layer 4)"
		},
		{
			"depth": 2,
			"slug": "the-plan",
			"text": "The plan"
		},
		{
			"depth": 3,
			"slug": "gh1--close-the-transitive-rest-call",
			"text": "GH1 — close the transitive REST call"
		},
		{
			"depth": 3,
			"slug": "gh2--make-the-private-cache-complete-and-authoritative",
			"text": "GH2 — make the private cache complete and authoritative"
		},
		{
			"depth": 3,
			"slug": "gh3--self-host-the-forge-optional-end-state",
			"text": "GH3 — self-host the forge (optional end-state)"
		}
	];
}
var url = "src/content/atlas/nix-without-github.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/nix-without-github.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/nix-without-github.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
