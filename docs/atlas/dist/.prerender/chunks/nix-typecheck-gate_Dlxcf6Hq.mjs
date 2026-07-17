import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import { t as $$Callout } from "./Callout_va3z_Xoj.mjs";
import { t as $$Pill } from "./Pill_B5BzzkuA.mjs";
import { t as $$PrLink } from "./PrLink_DpwCuibs.mjs";
import { t as $$Issue } from "./Issue_CB1XoZJT.mjs";
import { t as $$Cite } from "./Cite_D-1zLbJ9.mjs";
//#region src/content/atlas/nix-typecheck-gate.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		code: "code",
		em: "em",
		h2: "h2",
		h3: "h3",
		hr: "hr",
		li: "li",
		p: "p",
		strong: "strong",
		table: "table",
		tbody: "tbody",
		td: "td",
		th: "th",
		thead: "thead",
		tr: "tr",
		ul: "ul"
	}, props.components);
	const { Fragment: Fragment$1 } = _components;
	if (!Fragment$1) _missingMdxReference("Fragment", true);
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: createVNode(_components.em, { children: "Talk-mode response · diagnosis confirmed against source · design reviewed (Lowy + Hickey) and revised." }) }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "Verdict — the diagnosis is correct, with one sharpening: CI already catches this",
			children: createVNode(_components.p, { children: [
				"At the time of this diagnosis a standalone ",
				createVNode(_components.code, { children: "typecheck" }),
				" node ran in the CI DAG, so a server type error ",
				createVNode(_components.em, { children: "could not" }),
				" reach ",
				createVNode(_components.code, { children: "master" }),
				" through CI even then; ",
				createVNode($$PrLink, { pr: 1056 }),
				" has since replaced that node with the cached ",
				createVNode(_components.code, { children: "checks.*.typecheck" }),
				" flake output realized by the ",
				createVNode(_components.code, { children: "nix" }),
				" devour-flake node (",
				createVNode($$Cite, {
					file: "ci/mod.just",
					lines: "86-90"
				}),
				"). The real, narrower gap was ",
				createVNode(_components.strong, { children: "local false confidence" }),
				": a standalone ",
				createVNode(_components.code, { children: "nix build" }),
				" exits 0 with broken types (incident #1034), and ",
				createVNode(_components.code, { children: "nix build" }),
				" is therefore not the proof people treat it as. The fix the issue asks for — make ",
				createVNode(_components.code, { children: "nix build" }),
				" itself a type-proof — is worth doing, and it also lets us ",
				createVNode(_components.em, { children: "delete" }),
				" a CI node rather than add one."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "what-i-verified",
			children: "What I verified"
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Claim in the issue" }),
					"\n",
					createVNode(_components.th, { children: "Status" }),
					"\n",
					createVNode(_components.th, { children: "Source" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: ["nix build only runs the Vite client bundle, no ", createVNode(_components.code, { children: "tsc" })] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "ok",
						children: "true"
					}) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$Cite, {
							file: "default.nix",
							lines: "87-95"
						}),
						" — ",
						createVNode(_components.code, { children: "buildPhase" }),
						" = ",
						createVNode(_components.code, { children: "pnpm --filter kolu-client build" }),
						" only"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"Server ships as ",
						createVNode(_components.code, { children: ".ts" }),
						", run under ",
						createVNode(_components.code, { children: "tsx" }),
						" (transpile-only)"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "ok",
						children: "true"
					}) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$Cite, {
							file: "default.nix",
							lines: "154-155"
						}),
						" — ",
						createVNode(_components.code, { children: "tsx … server/src/index.ts" })
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "typescript" }), " pruned from the production closure"] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "ok",
						children: "true"
					}) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$Cite, {
							file: "default.nix",
							lines: "109"
						}),
						" — in ",
						createVNode(_components.code, { children: "installPhase" }),
						" (after build, before ",
						createVNode(_components.code, { children: "cp -r . $out" }),
						")"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"No ",
						createVNode(_components.code, { children: "checkPhase" }),
						" / ",
						createVNode(_components.code, { children: "doCheck" }),
						" on the derivation"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "ok",
						children: "true"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Cite, {
						file: "default.nix",
						lines: "59-126"
					}) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"The real gate is ",
						createVNode(_components.code, { children: "just check" }),
						" / CI"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "warn",
						children: "partly"
					}) }),
					"\n",
					createVNode(_components.td, { children: [
						"CI ",
						createVNode(_components.em, { children: "did" }),
						" gate: the DAG then included a standalone ",
						createVNode(_components.code, { children: "typecheck" }),
						" → ",
						createVNode(_components.code, { children: "pnpm typecheck" }),
						" node (deleted by ",
						createVNode($$PrLink, { pr: 1056 }),
						" in favour of the flake check). ",
						createVNode(_components.code, { children: "just check" }),
						" (",
						createVNode($$Cite, {
							file: "justfile",
							lines: "67-68"
						}),
						") is the local inner loop."
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: "So the path that gives false confidence:" }),
		"\n",
		createVNode("div", {
			style: {
				display: "flex",
				gap: "0.5rem",
				flexWrap: "wrap",
				alignItems: "center",
				fontFamily: "var(--mono)",
				fontSize: "0.8rem",
				margin: "0.8rem 0"
			},
			children: [
				createVNode("span", {
					style: {
						background: "var(--code-bg)",
						border: "1px solid var(--rule)",
						borderRadius: "6px",
						padding: "0.3rem 0.55rem"
					},
					children: ["edit server ", createVNode(_components.code, { children: ".ts" })]
				}),
				createVNode("span", {
					style: { color: "var(--ink-faint)" },
					children: "→"
				}),
				createVNode("span", {
					style: {
						background: "var(--code-bg)",
						border: "1px solid var(--rule)",
						borderRadius: "6px",
						padding: "0.3rem 0.55rem"
					},
					children: "nix build .#default"
				}),
				createVNode("span", {
					style: { color: "var(--ink-faint)" },
					children: "→"
				}),
				createVNode("span", {
					style: {
						background: "#fcf0ef",
						border: "1px solid #e8b9b5",
						color: "#b42318",
						borderRadius: "6px",
						padding: "0.3rem 0.55rem"
					},
					children: "no tsc runs"
				}),
				createVNode("span", {
					style: { color: "var(--ink-faint)" },
					children: "→"
				}),
				createVNode("span", {
					style: {
						background: "#eff6f0",
						border: "1px solid #bce3c8",
						color: "#1b7a3a",
						borderRadius: "6px",
						padding: "0.3rem 0.55rem"
					},
					children: "exit 0"
				}),
				createVNode("span", {
					style: { color: "var(--ink-faint)" },
					children: "→"
				}),
				createVNode("span", {
					style: {
						background: "var(--code-bg)",
						border: "1px solid var(--rule)",
						borderRadius: "6px",
						padding: "0.3rem 0.55rem"
					},
					children: "“safe to deploy” ✗"
				})
			]
		}),
		"\n",
		createVNode(_components.h2, {
			id: "recommendation--a-checkstypecheck-derivation",
			children: [
				"Recommendation — a ",
				createVNode(_components.code, { children: "checks.typecheck" }),
				" derivation"
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Add a typecheck ",
			createVNode(_components.em, { children: "derivation" }),
			" to the root ",
			createVNode(_components.code, { children: "flake.nix" }),
			" that reuses ",
			createVNode(_components.code, { children: "pnpmDeps" }),
			", runs ",
			createVNode(_components.code, { children: "pnpm -r typecheck" }),
			", and ",
			createVNode(_components.code, { children: "touch $out" }),
			" on success. Three things fall out of this:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "It becomes a hard, un-skippable gate." }),
				" The CI ",
				createVNode(_components.code, { children: "nix" }),
				" node builds ",
				createVNode(_components.em, { children: "all" }),
				" flake outputs via devour-flake (",
				createVNode($$Cite, {
					file: "ci/mod.just",
					lines: "63-64"
				}),
				"). A new ",
				createVNode(_components.code, { children: "checks.*" }),
				" output is picked up automatically — no new CI recipe needed."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "It’s content-addressed." }),
				" The derivation only re-runs when its source changes, and the result is shared through ",
				createVNode(_components.code, { children: "cache.nixos.asia/oss" }),
				". The current ",
				createVNode(_components.code, { children: "ci::typecheck" }),
				" recipe re-runs ",
				createVNode(_components.code, { children: "pnpm typecheck" }),
				" unconditionally every pipeline."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "It lets us delete a node." }),
				" Once typecheck is a flake output covered by the ",
				createVNode(_components.code, { children: "nix" }),
				" node, the standalone ",
				createVNode(_components.code, { children: "typecheck" }),
				" recipe and its DAG edge are redundant → remove them. Net: ",
				createVNode(_components.strong, { children: "3 typecheck loci → 3" }),
				" (package.json script, ",
				createVNode(_components.code, { children: "just check" }),
				", nix derivation), one fewer CI node, all still delegating to the one shared ",
				createVNode(_components.code, { children: "pnpm -r typecheck" }),
				" mechanism."
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "Why a separate derivation and not .#default's buildPhase",
			children: createVNode(_components.p, { children: [
				"“Produce a runnable artifact” and “prove types are sound” are independent axes of change — incident #1034 ",
				createVNode(_components.em, { children: "is" }),
				" the proof they diverge. Folding ",
				createVNode(_components.code, { children: "tsc" }),
				" into ",
				createVNode(_components.code, { children: ".#default" }),
				" would complect them: a type-only edit would bust the artifact cache, and ",
				createVNode(_components.code, { children: "nix run ." }),
				" / ",
				createVNode(_components.code, { children: "smoke" }),
				" / ",
				createVNode(_components.code, { children: "e2e" }),
				" would pay a typecheck tax for nothing. The build needs node-gyp + Vite + font symlinks + commit stamping; typecheck needs only ",
				createVNode(_components.code, { children: "tsc" }),
				" + node_modules. Keep them as causally independent outputs sharing ",
				createVNode(_components.code, { children: "pnpmDeps" }),
				". ",
				createVNode(_components.em, { children: "(Lowy: correct seam, Nix layer is where the burned consumer lives.)" })
			] })
		}),
		"\n",
		createVNode(_components.h3, {
			id: "the-trap-to-avoid--fileset-drift-must-fix",
			children: ["The trap to avoid — fileset drift ", createVNode($$Pill, {
				variant: "bad",
				children: "must-fix"
			})]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The build’s ",
			createVNode(_components.code, { children: "src" }),
			" fileset (",
			createVNode($$Cite, {
				file: "default.nix",
				lines: "15-38"
			}),
			") is a hand-maintained allowlist of package dirs — and it ",
			createVNode(_components.strong, { children: ["omits ", createVNode(_components.code, { children: "packages/tests" })] }),
			". If the typecheck derivation reused that fileset, it would typecheck a ",
			createVNode(_components.em, { children: "different, smaller" }),
			" set than ",
			createVNode(_components.code, { children: "just check" }),
			" (which sees the whole working tree). A package added to ",
			createVNode(_components.code, { children: "pnpm-workspace.yaml" }),
			" but forgotten in the fileset would type-error while the derivation exits 0 — reintroducing the exact false-green #1049 is about, just relocated."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "Resolution (chosen): give the typecheck derivation its own broad fileset",
			children: [createVNode(_components.p, { children: [
				"Source it from ",
				createVNode(_components.code, { children: "./packages" }),
				" wholesale (plus root ",
				createVNode(_components.code, { children: "tsconfig.base.json" }),
				", ",
				createVNode(_components.code, { children: "package.json" }),
				", ",
				createVNode(_components.code, { children: "pnpm-workspace.yaml" }),
				", lockfile) rather than the narrow shipping allowlist. There is then ",
				createVNode(_components.strong, { children: "no per-package list to drift" }),
				" — ",
				createVNode(_components.code, { children: "pnpm -r typecheck" }),
				" sees exactly the workspace, by construction. This is simpler than the alternative (a second ",
				createVNode(_components.code, { children: "checks.fileset-completeness" }),
				" derivation diffing the workspace against the allowlist), and the broader source is ",
				createVNode(_components.em, { children: "correct" }),
				" for typecheck anyway: it ",
				createVNode(_components.em, { children: "should" }),
				" re-run whenever any typechecked package changes. The build keeps its tight allowlist for cache reasons; the two filesets have opposite goals, so they should differ."
			] }), createVNode(_components.p, { children: [
				createVNode(_components.strong, { children: "As built, this was reversed." }),
				" ",
				createVNode($$PrLink, { pr: 1056 }),
				" has the typecheck derivation (",
				createVNode(_components.code, { children: "nix/pnpm-typecheck.nix" }),
				") reuse the build’s narrow allowlist ",
				createVNode(_components.code, { children: "src" }),
				" + ",
				createVNode(_components.code, { children: "pnpmDeps" }),
				", and holds off the drift trap with an INVARIANT comment on the fileset instead (",
				createVNode($$Cite, {
					file: "default.nix",
					lines: "21-26"
				}),
				"): every workspace package with a ",
				createVNode(_components.code, { children: "typecheck" }),
				" script must be listed, and ",
				createVNode(_components.code, { children: "packages/tests" }),
				" — the one member absent — has no typecheck script, so it is outside the gate’s scope either way."
			] })]
		}),
		"\n",
		createVNode(_components.h3, {
			id: "pin-to-one-platform-cost",
			children: ["Pin to one platform ", createVNode($$Pill, {
				variant: "warn",
				children: "cost"
			})]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"devour-flake builds ",
			createVNode(_components.code, { children: "checks.${system}" }),
			" for all three systems. TypeScript typecheck is platform-independent, so attaching it to all three triples CI cost for identical results. Pin it to one — following the existing precedent ",
			createVNode($$Cite, {
				file: "nix/home/example/flake.nix",
				lines: "70"
			}),
			" (",
			createVNode(_components.code, { children: "checks.${linuxSystem}.vm-test" }),
			") and ",
			createVNode($$Cite, {
				file: "nix/home/example/flake.nix",
				lines: "114"
			}),
			" (",
			createVNode(_components.code, { children: "checks.${darwinSystem}" }),
			")."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "As built, this was reversed too." }),
			" ",
			createVNode($$PrLink, { pr: 1056 }),
			" runs the type gates on ",
			createVNode(_components.em, { children: "every" }),
			" system, deliberately: the build environment (nodejs/pnpm and the platform-resolved deps ",
			createVNode(_components.code, { children: "pnpmConfigHook" }),
			" installs) differs per platform, so each platform’s ",
			createVNode(_components.code, { children: "tsc" }),
			"/",
			createVNode(_components.code, { children: "astro check" }),
			" is its own proof — a darwin-only type error wouldn’t surface from a linux-only check (rationale comment in ",
			createVNode($$Cite, {
				file: "flake.nix",
				lines: "66-72"
			}),
			")."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "concrete-change-single-pr--infra-not-user-visible-no-phasing",
			children: "Concrete change (single PR — infra, not user-visible, no phasing)"
		}),
		"\n",
		createVNode(_components.h3, {
			id: "1--flakenix--add-the-check-output",
			children: [
				"1 · ",
				createVNode(_components.code, { children: "flake.nix" }),
				" — add the check output"
			]
		}),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"diff\"><code><span class=\"line\"><span style=\"color:#22863A\"><span style=\"user-select: none;\">+</span># typecheck the whole workspace as a cached, devour-flake-gated proof.</span></span>\n<span class=\"line\"><span style=\"color:#22863A\"><span style=\"user-select: none;\">+</span># Own broad fileset (all of ./packages) — NOT default.nix's narrow shipping</span></span>\n<span class=\"line\"><span style=\"color:#22863A\"><span style=\"user-select: none;\">+</span># allowlist — so a new package can never silently escape the gate (#1049).</span></span>\n<span class=\"line\"><span style=\"color:#22863A\"><span style=\"user-select: none;\">+</span># Pinned to one system: tsc is platform-independent (cf. nix/home/example).</span></span>\n<span class=\"line\"><span style=\"color:#22863A\"><span style=\"user-select: none;\">+</span>checks.${linuxSystem}.typecheck = import ./nix/typecheck.nix { inherit pkgs; };</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			"A small ",
			createVNode(_components.code, { children: "nix/typecheck.nix" }),
			" leaf: ",
			createVNode(_components.code, { children: "mkDerivation" }),
			" reusing ",
			createVNode(_components.code, { children: "pnpmDeps" }),
			" + ",
			createVNode(_components.code, { children: "pnpmConfigHook" }),
			", ",
			createVNode(_components.code, { children: "buildPhase = \"pnpm -r typecheck\"" }),
			", ",
			createVNode(_components.code, { children: "installPhase = \"touch $out\"" }),
			". No node-gyp rebuild — ",
			createVNode(_components.code, { children: "tsc --noEmit" }),
			" needs ",
			createVNode(_components.code, { children: ".d.ts" }),
			", not the compiled ",
			createVNode(_components.code, { children: ".node" }),
			"."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "2--cimodjust--delete-the-now-redundant-recipe",
			children: [
				"2 · ",
				createVNode(_components.code, { children: "ci/mod.just" }),
				" — delete the now-redundant recipe"
			]
		}),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"diff\"><code><span class=\"line\"><span style=\"color:#B31D28\"><span style=\"user-select: none;\">-</span>default: nix home-manager e2e smoke fmt typecheck biome unit surface-example-build pnpm-hash-fresh</span></span>\n<span class=\"line\"><span style=\"color:#22863A\"><span style=\"user-select: none;\">+</span>default: nix home-manager e2e smoke fmt biome unit surface-example-build pnpm-hash-fresh</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#B31D28\"><span style=\"user-select: none;\">-</span>typecheck: install</span></span>\n<span class=\"line\"><span style=\"color:#B31D28\"><span style=\"user-select: none;\">-</span>    {{ nix_shell }} pnpm typecheck</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			"And one comment at the ",
			createVNode(_components.code, { children: "nix:" }),
			" recipe (",
			createVNode($$Cite, {
				file: "ci/mod.just",
				lines: "63"
			}),
			") noting that ",
			createVNode(_components.code, { children: "checks.typecheck" }),
			" (built here via devour-flake) replaced the standalone recipe — so the temporal coupling (“the ",
			createVNode(_components.code, { children: "nix" }),
			" node is now load-bearing for typecheck”) is documented, not folklore."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "3--defaultnix--one-comment-at-the-buildphase",
			children: [
				"3 · ",
				createVNode(_components.code, { children: "default.nix" }),
				" — one comment at the buildPhase"
			]
		}),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"diff\"><code><span class=\"line\"><span style=\"color:#24292E\"> buildPhase = ''</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">   runHook preBuild</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">   ...</span></span>\n<span class=\"line\"><span style=\"color:#22863A\"><span style=\"user-select: none;\">+</span>  # NOTE: this does NOT typecheck — only the Vite client bundle is built and</span></span>\n<span class=\"line\"><span style=\"color:#22863A\"><span style=\"user-select: none;\">+</span>  # the server runs under tsx. The type gate is `nix build .#checks…typecheck`</span></span>\n<span class=\"line\"><span style=\"color:#22863A\"><span style=\"user-select: none;\">+</span>  # (run by CI's `nix` node). A green `nix build .#default` is not a type-proof.</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">   pnpm --filter kolu-client build</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">   runHook postBuild</span></span>\n<span class=\"line\"><span style=\"color:#24292E\"> '';</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			"Leave ",
			createVNode(_components.code, { children: "just check" }),
			" (",
			createVNode($$Cite, {
				file: "justfile",
				lines: "67-68"
			}),
			") exactly as-is — it stays the fast local inner loop. No pre-push hook needed: making ",
			createVNode(_components.code, { children: "nix build" }),
			" a type-proof and keeping the CI gate is sufficient; a hook would be a fourth locus for the same concept."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "what-i-deliberately-rejected",
			children: "What I deliberately rejected"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"Folding ",
					createVNode(_components.code, { children: "tsc" }),
					" into ",
					createVNode(_components.code, { children: ".#default" }),
					"."
				] }),
				" Complects artifact-production with type-proof; taxes ",
				createVNode(_components.code, { children: "nix run" }),
				" / smoke / e2e; busts the build cache on type-only edits."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"A separate ",
					createVNode(_components.code, { children: "checks.fileset-completeness" }),
					" guard."
				] }),
				" Hickey’s fix for the drift trap is valid, but the broad-fileset approach above kills the same failure mode ",
				createVNode(_components.em, { children: "by construction" }),
				" with no new abstraction — preferred unless a narrow fileset must be kept for caching (it needn’t be)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"Docs-only (“just rely on the existing CI ",
					createVNode(_components.code, { children: "typecheck" }),
					" node”)."
				] }),
				" Honest and zero-abstraction, but it leaves ",
				createVNode(_components.code, { children: "nix build" }),
				" a non-proof — which is the issue’s actual ask — and forgoes the cache win. The buildPhase comment ships regardless; the derivation is the part that closes the gap."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.hr, {}),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "Shipped",
			children: createVNode(_components.p, { children: [
				createVNode($$PrLink, { pr: 1056 }),
				" (merged 2026-05-31) implemented this brief and closed ",
				createVNode($$Issue, { n: 1049 }),
				". As built: the derivation lives in ",
				createVNode(_components.code, { children: "nix/pnpm-typecheck.nix" }),
				" (shared by the workspace ",
				createVNode(_components.code, { children: "tsc" }),
				" gate and the website ",
				createVNode(_components.code, { children: "astro check" }),
				" gate), exposed as flake checks and realized by CI’s ",
				createVNode(_components.code, { children: "nix" }),
				"/devour-flake node; the standalone ",
				createVNode(_components.code, { children: "ci::typecheck" }),
				" recipe was deleted as planned, and the ",
				createVNode(_components.code, { children: "buildPhase" }),
				" NOTE comment shipped (",
				createVNode($$Cite, {
					file: "default.nix",
					lines: "142-146"
				}),
				"). Two decisions changed during implementation — the must-fix (broad fileset) and the cost-fix (single-platform pin) were both reversed when re-checked against the actual derivation; see the as-built notes above."
			] })
		})
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
function _missingMdxReference(id, component) {
	throw new Error("Expected " + (component ? "component" : "object") + " `" + id + "` to be defined: you likely forgot to import, pass, or provide it.");
}
var frontmatter = {
	"title": "nix build ≠ typecheck",
	"description": "A talk-mode diagnosis of #1049 — a green `nix build` exits 0 with broken server types; the fix is a cached `checks.typecheck` flake derivation that closes the local false-confidence gap and deletes a CI node.",
	"parents": ["reference"],
	"maturity": "evergreen",
	"status": "implemented",
	"updated": "2026-06-10T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "what-i-verified",
			"text": "What I verified"
		},
		{
			"depth": 2,
			"slug": "recommendation--a-checkstypecheck-derivation",
			"text": "Recommendation — a checks.typecheck derivation"
		},
		{
			"depth": 3,
			"slug": "the-trap-to-avoid--fileset-drift-must-fix",
			"text": "The trap to avoid — fileset drift must-fix"
		},
		{
			"depth": 3,
			"slug": "pin-to-one-platform-cost",
			"text": "Pin to one platform cost"
		},
		{
			"depth": 2,
			"slug": "concrete-change-single-pr--infra-not-user-visible-no-phasing",
			"text": "Concrete change (single PR — infra, not user-visible, no phasing)"
		},
		{
			"depth": 3,
			"slug": "1--flakenix--add-the-check-output",
			"text": "1 · flake.nix — add the check output"
		},
		{
			"depth": 3,
			"slug": "2--cimodjust--delete-the-now-redundant-recipe",
			"text": "2 · ci/mod.just — delete the now-redundant recipe"
		},
		{
			"depth": 3,
			"slug": "3--defaultnix--one-comment-at-the-buildphase",
			"text": "3 · default.nix — one comment at the buildPhase"
		},
		{
			"depth": 2,
			"slug": "what-i-deliberately-rejected",
			"text": "What I deliberately rejected"
		}
	];
}
var url = "src/content/atlas/nix-typecheck-gate.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/nix-typecheck-gate.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/nix-typecheck-gate.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
