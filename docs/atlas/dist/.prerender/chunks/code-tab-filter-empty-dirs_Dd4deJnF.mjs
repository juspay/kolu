import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$Pill } from "./Pill_DD4u2LYa.mjs";
//#region src/content/atlas/code-tab-filter-empty-dirs.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		code: "code",
		em: "em",
		h2: "h2",
		h3: "h3",
		li: "li",
		p: "p",
		pre: "pre",
		span: "span",
		strong: "strong",
		table: "table",
		tbody: "tbody",
		td: "td",
		th: "th",
		thead: "thead",
		tr: "tr",
		ul: "ul"
	}, props.components);
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: [
			"Diagnosis · branch ",
			createVNode(_components.code, { children: "search-collapsae" }),
			" · confirmed against kolu source and\n",
			createVNode(_components.code, { children: "@pierre/trees@1.0.0-beta.4" }),
			" internals.\n",
			createVNode(_components.strong, { children: "Fixed" }),
			" in ",
			createVNode($$PrLink, { pr: 1096 }),
			" (merged 2026-06-01) — ",
			createVNode(_components.code, { children: "directoryRemovalOps" }),
			" in\n",
			createVNode(_components.code, { children: "packages/solid-pierre/src/pathReconcile.ts" }),
			"."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "danger",
			title: "Root cause",
			children: [createVNode(_components.p, { children: [
				"The filter removed the matching ",
				createVNode(_components.em, { children: "files" }),
				", but nothing removed the directories\nthose removals left empty — and Pierre deliberately keeps an emptied directory\nas a visible “explicit” folder."
			] }), createVNode(_components.p, { children: [
				"Searching ",
				createVNode(_components.code, { children: "docs plans" }),
				" batch-",
				createVNode(_components.code, { children: "remove" }),
				"d every non-matching file. Pierre’s\n",
				createVNode(_components.code, { children: "removePath" }),
				" removes only the file node, then ",
				createVNode(_components.strong, { children: ["promotes the now-empty parent\ndirectory to ", createVNode(_components.code, { children: "EXPLICIT" })] }),
				" instead of deleting it. So the whole tree of\nresult-less directories survived. The wrapper comment claiming the opposite — “a\nfile dropped takes its now-empty ancestor directories with it” (then ",
				createVNode(_components.code, { children: "FileTree.tsx:55-58" }),
				")\n— was ",
				createVNode(_components.strong, { children: [
					"false for ",
					createVNode(_components.code, { children: "batch" }),
					"/",
					createVNode(_components.code, { children: "remove" })
				] }),
				"; it was only true for ",
				createVNode(_components.code, { children: "resetPaths" }),
				", which this\nbranch abandoned to preserve hand-expansion. ",
				createVNode($$PrLink, { pr: 1096 }),
				" removed that\ncomment when it extracted ",
				createVNode(_components.code, { children: "pathDiffOperations" }),
				" into\n",
				createVNode(_components.code, { children: "packages/solid-pierre/src/pathReconcile.ts" }),
				", whose doc comment now states the\npromote-to-explicit behavior correctly."
			] })]
		}),
		"\n",
		createVNode(_components.h2, {
			id: "how-the-filter-is-wired",
			children: "How the filter is wired"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The Code-tab search is ",
			createVNode(_components.strong, { children: "host-driven" }),
			" — Pierre’s own search is off, and kolu\nprojects a path set into the tree:"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "type in filter" }),
			" → ",
			createVNode(_components.code, { children: "searchQuery()" }),
			" → ",
			createVNode(_components.code, { children: "projectFileTreeSearch" }),
			" → ",
			createVNode(_components.code, { children: "{ projectedPaths, expandedAncestors }" }),
			" → ",
			createVNode(_components.code, { children: "<FileTree>" }),
			" batch + expand"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "projectFileTreeSearch(treePaths(), searchQuery())" }),
				" (",
				createVNode(_components.code, { children: "CodeTab.tsx:331-333" }),
				") returns ",
				createVNode(_components.code, { children: "projectedPaths" }),
				" (matching ",
				createVNode(_components.strong, { children: "files only" }),
				") and ",
				createVNode(_components.code, { children: "expandedAncestors" }),
				" (",
				createVNode(_components.code, { children: "fileSearch.ts:44-62" }),
				"). For ",
				createVNode(_components.code, { children: "docs plans" }),
				" that’s the files under ",
				createVNode(_components.code, { children: "docs/plans/" }),
				" and the ancestors ",
				createVNode(_components.code, { children: "[\"docs/\", \"docs/plans/\"]" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "<FileTree>" }),
				" receives ",
				createVNode(_components.code, { children: "paths={…projectedPaths}" }),
				", ",
				createVNode(_components.code, { children: "search={false}" }),
				", ",
				createVNode(_components.code, { children: "expandPaths={…expandedAncestors}" }),
				". ",
				createVNode(_components.code, { children: "search={false}" }),
				" means Pierre’s ",
				createVNode(_components.code, { children: "hide-non-matches" }),
				" machinery is dormant — ",
				createVNode(_components.strong, { children: "all filtering is kolu-side" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"The wrapper turns the old inventory into the new one as an ",
				createVNode(_components.strong, { children: "in-place delta" }),
				": ",
				createVNode(_components.code, { children: "pathDiffOperations(appliedPaths, paths)" }),
				" emits ",
				createVNode(_components.code, { children: "{type:\"remove\"}" }),
				" for each dropped file, then ",
				createVNode(_components.code, { children: "tree.batch(ops)" }),
				", then additively ",
				createVNode(_components.code, { children: ".expand()" }),
				"s the ancestors (",
				createVNode(_components.code, { children: "FileTree.tsx:205-227" }),
				"). It uses ",
				createVNode(_components.code, { children: "batch" }),
				" rather than ",
				createVNode(_components.code, { children: "resetPaths" }),
				" specifically so hand-opened folders survive."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "what-i-verified-in-pierres-source",
			children: "What I verified in Pierre’s source"
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Claim" }),
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
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "tree.batch([{remove}])" }),
						" ⇒ ",
						createVNode(_components.code, { children: "store.remove" }),
						" ⇒ ",
						createVNode(_components.code, { children: "removePath" })
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "good",
						children: "true"
					}) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "FileTreeController.js:522" }),
						" → ",
						createVNode(_components.code, { children: "store.js:121-139" })
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "removeSubtree" }),
						" removes ",
						createVNode(_components.strong, { children: "only the target file node" }),
						", never its parent"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "good",
						children: "true"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "canonical.js:406-441" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"After unlinking the file, ",
						createVNode(_components.code, { children: "removePath" }),
						" calls ",
						createVNode(_components.code, { children: "promoteEmptyAncestorsToExplicit(parentId)" })
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "bad",
						children: "the bug"
					}) }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "canonical.js:46-66" }), " (line 56)"] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"That walks ",
						createVNode(_components.em, { children: "up" }),
						" and flags every emptied directory ",
						createVNode(_components.code, { children: "EXPLICIT" }),
						" instead of deleting it"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "bad",
						children: "the bug"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "canonical.js:442-451" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"An ",
						createVNode(_components.code, { children: "EXPLICIT" }),
						" empty directory stays a visible row"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "good",
						children: "true"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "canonical.js:201,222,557" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"The wrapper only ever ",
						createVNode(_components.code, { children: ".expand()" }),
						"s; it never collapses"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "good",
						children: "true"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "FileTree.tsx:198,219-222" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"The filter input has ",
						createVNode(_components.strong, { children: "no debounce" }),
						" — every keystroke re-projects"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "good",
						children: "true"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "FileSearchInput.tsx:19" }) }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: "The decisive few lines:" }),
		"\n",
		createVNode(_components.pre, {
			class: "astro-code github-light",
			style: {
				backgroundColor: "#fff",
				color: "#24292e",
				overflowX: "auto"
			},
			tabindex: "0",
			"data-language": "js",
			children: createVNode(_components.code, { children: [
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// path-store/src/canonical.js — removePath"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "const"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " removedNodeIds"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " removeSubtree"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(state, nodeId);   "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// removes ONLY the file node"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "removeChildReference"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(state, parentId, nodeId, …);      "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// unlinks it from the parent"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "promoteEmptyAncestorsToExplicit"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(state, parentId);      "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// ← the emptied directory SURVIVES"
						})
					]
				}),
				"\n",
				createVNode(_components.span, { class: "line" }),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// promoteEmptyAncestorsToExplicit"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "while"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " (currentDirectoryId "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "!="
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " null"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ") {"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "  if"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " ("
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "getDirectoryIndex"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(state, currentDirectoryId).childIds."
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: "length"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " >"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " 0"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ") "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "return"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  addNodeFlag"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(currentNode, "
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: "PATH_STORE_NODE_FLAG_EXPLICIT"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ");  "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// keep the empty folder visible"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "  currentDirectoryId "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " currentNode.parentId;               "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// …and keep walking up"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "}"
					})
				})
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "why-the-screenshot-looks-the-way-it-does",
			children: "Why the screenshot looks the way it does"
		}),
		"\n",
		createVNode(_components.h3, {
			id: "why-the-directories-are-present-at-all-defect-a",
			children: ["Why the directories are present at all ", createVNode($$Pill, {
				variant: "bad",
				children: "defect A"
			})]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "pathDiffOperations" }),
			" (then ",
			createVNode(_components.code, { children: "FileTree.tsx:59-73" }),
			", now\n",
			createVNode(_components.code, { children: "packages/solid-pierre/src/pathReconcile.ts" }),
			") diffs only ",
			createVNode(_components.strong, { children: "file" }),
			" path lists;\ndirectories never appear in ",
			createVNode(_components.code, { children: "projectedPaths" }),
			", so no remove op ever targets a\ndirectory. Every directory that contained only non-matching files is emptied by\nthe file removals and then promoted to a persistent empty folder. Net: the\nentire pre-search directory skeleton remains, now hollow."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "why-theyre-shown-expanded-defect-b",
			children: [
				"Why they’re shown ",
				createVNode(_components.em, { children: "expanded" }),
				" ",
				createVNode($$Pill, {
					variant: "warn",
					children: "defect B"
				})
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Two compounding facts, both about expansion being ",
			createVNode(_components.strong, { children: "monotonic" }),
			":"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "No debounce" }),
				" → every intermediate keystroke re-projects. Typing ",
				createVNode(_components.code, { children: "d" }),
				" matches almost every path, so ",
				createVNode(_components.code, { children: "expandedAncestors" }),
				" ≈ ",
				createVNode(_components.em, { children: "every directory" }),
				", and the wrapper ",
				createVNode(_components.code, { children: ".expand()" }),
				"s them all."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"As the query narrows to ",
				createVNode(_components.code, { children: "docs plans" }),
				", the files vanish but the wrapper ",
				createVNode(_components.strong, { children: "never collapses" }),
				", and Pierre keeps the expanded flag on a directory even after it’s emptied. So the leftover empty dirs stay expanded."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: ".github/workflows" }),
			" is the lone collapsed row because no intermediate prefix ever\nexpanded it. Even with a single ",
			createVNode(_components.em, { children: "paste" }),
			" of ",
			createVNode(_components.code, { children: "docs plans" }),
			", the empty directories\nwould still appear — just collapsed rather than expanded."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "The trace, end to end",
			children: createVNode(_components.p, { children: "remove non-matching files (batch) → parents emptied → promoted to EXPLICIT →\nstill listed → + stale expanded flag → empty expanded rows." })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "fix--hickey--lowy-verdict-shipped",
			children: ["Fix — /hickey + /lowy verdict ", createVNode($$Pill, {
				variant: "done",
				children: "shipped"
			})]
		}),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "Chosen: prune the emptied directories inside FileTree.tsx, derived from the file set",
			children: createVNode(_components.p, { children: [
				"Reject the collapse pass. Reject ",
				createVNode(_components.code, { children: "resetPaths" }),
				"-on-filter. Lowy fixes the\n",
				createVNode(_components.em, { children: "boundary" }),
				" (the fix belongs in the wrapper; ",
				createVNode(_components.code, { children: "fileSearch.ts" }),
				" and ",
				createVNode(_components.code, { children: "CodeTab.tsx" }),
				"\nstay inert). Hickey fixes the ",
				createVNode(_components.em, { children: "internals" }),
				" (derive directories from\n",
				createVNode(_components.code, { children: "appliedPaths" }),
				"; no parallel ",
				createVNode(_components.code, { children: "appliedDirs" }),
				" state; no collapse pass). They are the\nintended complement — Lowy gets the seam right, Hickey gets the structure right."
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			"This landed in ",
			createVNode($$PrLink, { pr: 1096 }),
			" as ",
			createVNode(_components.code, { children: "directoryRemovalOps(prev, next)" }),
			" in\n",
			createVNode(_components.code, { children: "packages/solid-pierre/src/pathReconcile.ts" }),
			", invoked from ",
			createVNode(_components.code, { children: "FileTree.tsx" }),
			". The\nshipped form supersedes the sketch below: it computes the disjoint maximal\ndead-subtree roots and removes them in a single batch, rather than per-directory\n",
			createVNode(_components.code, { children: "tree.batch" }),
			" calls in a sorted loop."
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Direction" }),
					"\n",
					createVNode(_components.th, { children: "/hickey" }),
					"\n",
					createVNode(_components.th, { children: "/lowy" }),
					"\n",
					createVNode(_components.th, { children: "Verdict" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "A · prune emptied dirs" }), " in the wrapper"] }),
					"\n",
					createVNode(_components.td, { children: [
						"Yes — but ",
						createVNode(_components.strong, { children: "derive" }),
						" dirs from the file set, don’t track ",
						createVNode(_components.code, { children: "appliedDirs" }),
						" (parallel array = silent-divergence)"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"Yes — correct seam; both ",
						createVNode(_components.code, { children: "fileSearch.ts" }),
						" and the wrapper stay put"
					] }),
					"\n",
					createVNode(_components.td, { children: [createVNode($$Pill, {
						variant: "good",
						children: "chosen"
					}), " in Hickey’s derived form"] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "B · collapse pass" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"No — ",
						createVNode(_components.code, { children: "collapse()" }),
						" on a dir the wrapper doesn’t own destroys hand-opens; the expand loop is safe only because it’s monotonic"
					] }),
					"\n",
					createVNode(_components.td, { children: "Add it for symmetry" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "bad",
						children: "rejected"
					}) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: [
						"C · ",
						createVNode(_components.code, { children: "resetPaths" }),
						" on active filter"
					] }) }),
					"\n",
					createVNode(_components.td, { children: [
						"No — mode-branch state machine; “user-expansions” is a ",
						createVNode(_components.em, { children: "ghost variable" }),
						" Pierre never exposes"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"No — couples the search-agnostic wrapper to ",
						createVNode(_components.code, { children: "CodeTab" }),
						"’s search axis"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "bad",
						children: "rejected"
					}) }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "resolving-the-disagreement-on-a--derive-dont-track",
			children: "Resolving the disagreement on A — derive, don’t track"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Lowy’s concrete prescription (“diff ",
			createVNode(_components.code, { children: "appliedDirs" }),
			" against ",
			createVNode(_components.code, { children: "new Set(expandPaths)" }),
			"”)\nhas a latent ",
			createVNode(_components.strong, { children: "filter-clear bug" }),
			": on an empty query ",
			createVNode(_components.code, { children: "projectFileTreeSearch" }),
			"\nreturns ",
			createVNode(_components.code, { children: "expandedAncestors: []" }),
			" while ",
			createVNode(_components.code, { children: "projectedPaths" }),
			" is the ",
			createVNode(_components.em, { children: "full" }),
			" inventory.\nUsing ",
			createVNode(_components.code, { children: "expandPaths" }),
			" as the directory authority would remove ",
			createVNode(_components.em, { children: "every" }),
			" directory the\nmoment the user clears the filter. Deriving the authority from the file set is\nimmune:"
		] }),
		"\n",
		createVNode(_components.pre, {
			class: "astro-code github-light",
			style: {
				backgroundColor: "#fff",
				color: "#24292e",
				overflowX: "auto"
			},
			tabindex: "0",
			"data-language": "ts",
			children: createVNode(_components.code, { children: [
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// after the file batch + appliedPaths = paths:"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "const"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " prevDirs"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " new"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " Set"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(appliedPaths."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "flatMap"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(ancestorDirectoryPaths));"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "const"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " nextDirs"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " new"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " Set"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(paths."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "flatMap"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(ancestorDirectoryPaths));   "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// full set on empty query ⇒ no removals"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "for"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " ("
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "const"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " dir"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " of"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " ["
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "..."
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "prevDirs]."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "filter"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "d"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " =>"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " !"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "nextDirs."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "has"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(d))"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "                               ."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "sort"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "a"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "b"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ") "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "=>"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " a."
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: "length"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " -"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " b."
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: "length"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ")) {  "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// shallowest first"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "  const"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " item"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " tree."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "getItem"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(dir);"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "  if"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " (item) tree."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "batch"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "([{ type: "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\"remove\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", path: dir, recursive: "
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: "true"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " }]); "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// emptied dirs still hold empty child dirs"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "}"
					})
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Two corrections to the originally-sketched op: ",
			createVNode(_components.strong, { children: "(1)" }),
			" ",
			createVNode(_components.code, { children: "recursive: true" }),
			" — an\nemptied directory still contains its (now-explicit) empty child directories, so a\nbare remove throws; ",
			createVNode(_components.strong, { children: "(2)" }),
			" shallowest-first so the maximal empty subtree is\nremoved in one op. No new tracked state: ",
			createVNode(_components.code, { children: "appliedPaths" }),
			" stays the single source."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "why-defect-b-folds-into-defect-a",
			children: "Why defect B folds into defect A"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Once empty directories are ",
			createVNode(_components.em, { children: "removed" }),
			", the “expanded empty rows” symptom is gone —\nan absent directory has no row to render open. And among the directories that\n",
			createVNode(_components.em, { children: "survive" }),
			", every one is an ancestor of a live match, so it ",
			createVNode(_components.strong, { children: "must stay expanded" }),
			".\nThere is no “surviving directory that should be collapsed” case during an active\nfilter — a collapse pass would re-hide matches and fight the user’s own collapse\n(the ",
			createVNode(_components.code, { children: "#867" }),
			" feature). Lowy’s symmetry is a ",
			createVNode(_components.em, { children: "false" }),
			" symmetry: expand-to-reveal is\nmandatory, collapse-to-hide is never wanted."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "test-plan-done",
			children: ["Test plan ", createVNode($$Pill, {
				variant: "done",
				children: "done"
			})]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "fileSearch.test.ts" }),
			" tests only the pure projection and ",
			createVNode(_components.strong, { children: "cannot" }),
			" see this bug —\nit never drives the Pierre ",
			createVNode(_components.code, { children: "batch" }),
			" where ",
			createVNode(_components.code, { children: "promoteEmptyAncestorsToExplicit" }),
			" lives.\nBoth layers landed in ",
			createVNode(_components.code, { children: "packages/solid-pierre/src/pathReconcile.test.ts" }),
			" via\n",
			createVNode($$PrLink, { pr: 1096 }),
			", with the integration layer driving a real Pierre tree\ndirectly instead of mounting ",
			createVNode(_components.code, { children: "<FileTree>" }),
			" in jsdom:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: ["Pure unit — extract ", createVNode(_components.code, { children: "directoryRemovalOps(prevFiles, nextFiles)" })] }), " and table-test it: empty/cleared query ⇒ no removals; single deep match ⇒ sibling subtrees removed, ancestors kept; nested empty subtree ⇒ one recursive op on the shallowest; dir with one matching + one non-matching file ⇒ kept; progressive narrowing ⇒ dirs that lost all matches removed."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: ["Integration — mount ", createVNode(_components.code, { children: "<FileTree>" })] }),
				" (jsdom): filter a populated tree and assert (a) emptied directories are ",
				createVNode(_components.em, { children: "absent" }),
				", (b) dirs still holding a match are present and expanded, (c) a directory the user collapses ",
				createVNode(_components.em, { children: "during" }),
				" a filter stays collapsed across the next keystroke (the ",
				createVNode(_components.code, { children: "#867" }),
				" guard)."
			] }),
			"\n"
		] })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "Code-tab filter strands empty directories",
	"description": "Why filtering the Code-tab tree left hollow, result-less folders — Pierre's remove promotes an emptied dir to EXPLICIT — and the directoryRemovalOps fix, with the /hickey + /lowy verdict.",
	"parents": ["solid-fileview", "bug"],
	"maturity": "budding",
	"updated": "2026-06-10T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "how-the-filter-is-wired",
			"text": "How the filter is wired"
		},
		{
			"depth": 2,
			"slug": "what-i-verified-in-pierres-source",
			"text": "What I verified in Pierre’s source"
		},
		{
			"depth": 2,
			"slug": "why-the-screenshot-looks-the-way-it-does",
			"text": "Why the screenshot looks the way it does"
		},
		{
			"depth": 3,
			"slug": "why-the-directories-are-present-at-all-defect-a",
			"text": "Why the directories are present at all defect A"
		},
		{
			"depth": 3,
			"slug": "why-theyre-shown-expanded-defect-b",
			"text": "Why they’re shown expanded defect B"
		},
		{
			"depth": 2,
			"slug": "fix--hickey--lowy-verdict-shipped",
			"text": "Fix — /hickey + /lowy verdict shipped"
		},
		{
			"depth": 3,
			"slug": "resolving-the-disagreement-on-a--derive-dont-track",
			"text": "Resolving the disagreement on A — derive, don’t track"
		},
		{
			"depth": 3,
			"slug": "why-defect-b-folds-into-defect-a",
			"text": "Why defect B folds into defect A"
		},
		{
			"depth": 2,
			"slug": "test-plan-done",
			"text": "Test plan done"
		}
	];
}
var url = "src/content/atlas/code-tab-filter-empty-dirs.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/code-tab-filter-empty-dirs.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/code-tab-filter-empty-dirs.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
