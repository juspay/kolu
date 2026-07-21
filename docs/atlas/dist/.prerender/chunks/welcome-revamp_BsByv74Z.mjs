import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$D2 } from "./D2_CPv-UX0x.mjs";
import { t as $$Pill } from "./Pill_DD4u2LYa.mjs";
import { t as $$Cite } from "./Cite_IypTixBQ.mjs";
import "./Milestone_yecymha0.mjs";
//#region src/content/atlas/welcome-revamp.mdx
var C = {
	bg: "#15171c",
	chrome: "#1b1e24",
	panel: "#171a20",
	line: "#2a2e37",
	fg: "#c7ccd6",
	dim: "#8b929d",
	faint: "#5b626d",
	amber: "#d6a35c",
	green: "#6cc070",
	blue: "#6ea8e0",
	red: "#d66c6c",
	purple: "#a594e8"
};
var Win = (props) => createVNode("div", {
	style: `margin:1.6rem 0;max-width:${props.w || "34rem"};border:1px solid ${C.line};border-radius:12px;overflow:hidden;background:${C.bg};box-shadow:0 6px 22px rgba(0,0,0,.32)`,
	children: [createVNode("div", {
		style: `display:flex;align-items:center;gap:.45rem;padding:.5rem .8rem;background:${C.chrome};border-bottom:1px solid ${C.line}`,
		children: [
			createVNode("span", { style: "width:10px;height:10px;border-radius:50%;background:#ff5f56;display:inline-block" }),
			createVNode("span", { style: "width:10px;height:10px;border-radius:50%;background:#ffbd2e;display:inline-block" }),
			createVNode("span", { style: "width:10px;height:10px;border-radius:50%;background:#27c93f;display:inline-block" }),
			createVNode("span", {
				style: `margin-left:.4rem;font:600 .72rem/1 ui-monospace,monospace;color:${C.dim}`,
				children: props.title
			})
		]
	}), createVNode("div", {
		style: "padding:1.1rem 1.15rem",
		children: props.children
	})]
});
var moments = [
	{
		icon: "📌",
		k: "Pin it",
		t: "Install kolu as an app — its own window, dock icon, and live agent badge.",
		chip: "PWA",
		c: C.amber
	},
	{
		icon: "🌐",
		k: "Reach it anywhere",
		t: "One Tailscale command and kolu follows you to your phone, over real HTTPS.",
		chip: "Tailscale",
		c: C.blue
	},
	{
		icon: "🤖",
		k: "Run agents",
		t: "Open a repo, drop a tile, launch Claude / Codex / OpenCode. Agent-agnostic.",
		chip: "Canvas",
		c: C.green
	}
];
var WelcomeMockup = () => createVNode(Win, {
	title: "kolu · welcome",
	w: "36rem",
	children: [
		createVNode("div", {
			style: `font:600 .95rem/1.4 ui-sans-serif,system-ui;color:${C.fg};margin-bottom:.2rem`,
			children: "Terminals on an infinite canvas. Any agent."
		}),
		createVNode("div", {
			style: `font:.8rem/1.5 ui-sans-serif,system-ui;color:${C.dim};margin-bottom:1rem`,
			children: "Three things worth doing first."
		}),
		createVNode("div", {
			style: "display:grid;grid-template-columns:1fr 1fr 1fr;gap:.6rem",
			children: moments.map((m) => createVNode("div", {
				style: `border:1px solid ${C.line};border-radius:10px;background:${C.panel};padding:.7rem .65rem`,
				children: [
					createVNode("div", {
						style: "font-size:1.05rem;margin-bottom:.35rem",
						children: m.icon
					}),
					createVNode("div", {
						style: `font:600 .78rem/1.2 ui-sans-serif,system-ui;color:${C.fg};margin-bottom:.25rem`,
						children: m.k
					}),
					createVNode("div", {
						style: `font:.68rem/1.45 ui-sans-serif,system-ui;color:${C.dim}`,
						children: m.t
					}),
					createVNode("div", {
						style: `margin-top:.5rem;display:inline-block;font:600 .56rem/1 ui-monospace,monospace;letter-spacing:.05em;text-transform:uppercase;color:${m.c};border:1px solid ${m.c}55;border-radius:5px;padding:.18rem .4rem`,
						children: m.chip
					})
				]
			}))
		}),
		createVNode("div", {
			style: `margin-top:1rem;padding-top:.85rem;border-top:1px solid ${C.line};display:flex;align-items:center;justify-content:space-between`,
			children: [createVNode("div", {
				style: `font:.72rem/1.4 ui-sans-serif,system-ui;color:${C.faint}`,
				children: [
					"New terminal ",
					createVNode("span", {
						style: `color:${C.dim};font-family:ui-monospace,monospace`,
						children: "⌘⏎"
					}),
					" \xA0·\xA0 Palette ",
					createVNode("span", {
						style: `color:${C.dim};font-family:ui-monospace,monospace`,
						children: "⌘K"
					})
				]
			}), createVNode("a", {
				style: `font:600 .72rem/1 ui-sans-serif,system-ui;color:${C.blue};text-decoration:none`,
				children: "Full guide → kolu.dev"
			})]
		}),
		createVNode("div", {
			style: `margin-top:.7rem;font:.66rem/1.4 ui-monospace,monospace;color:${C.faint}`,
			children: [
				"Closed it? ",
				createVNode("span", {
					style: `color:${C.dim}`,
					children: "⌘K → \"Tutorial\""
				}),
				" brings it back anytime."
			]
		})
	]
});
var Node = (props) => createVNode("div", {
	style: `flex:1;min-width:0;border:1px solid ${props.c}66;border-radius:9px;background:${C.panel};padding:.6rem .55rem;text-align:center`,
	children: [createVNode("div", {
		style: `font:600 .7rem/1.2 ui-sans-serif,system-ui;color:${props.c};margin-bottom:.2rem`,
		children: props.h
	}), createVNode("div", {
		style: `font:.62rem/1.35 ui-monospace,monospace;color:${C.dim};word-break:break-all`,
		children: props.s
	})]
});
var Arrow = () => createVNode("div", {
	style: `flex:none;align-self:center;color:${C.faint};font:700 1rem/1 ui-monospace,monospace;padding:0 .15rem`,
	children: "→"
});
var TailscaleBridge = () => createVNode("div", {
	style: "margin:1.6rem 0;max-width:40rem",
	children: [createVNode("div", {
		style: "display:flex;align-items:stretch;gap:.2rem",
		children: [
			createVNode(Node, {
				c: C.amber,
				h: "Plain HTTP",
				s: "http://100.x:PORT — manual pin only, off-LAN unreachable"
			}),
			createVNode(Arrow, {}),
			createVNode(Node, {
				c: C.amber,
				h: "tailscale serve",
				s: "tailscale serve --bg PORT"
			}),
			createVNode(Arrow, {}),
			createVNode(Node, {
				c: C.green,
				h: "✓ Real HTTPS",
				s: "https://box.tailnet.ts.net"
			})
		]
	}), createVNode("div", {
		style: `display:flex;gap:.5rem;margin-top:.6rem;font:600 .68rem/1.3 ui-sans-serif,system-ui`,
		children: [createVNode("div", {
			style: `flex:1;text-align:center;color:${C.green};border:1px dashed ${C.green}66;border-radius:8px;padding:.45rem`,
			children: ["↳ secure context → ", createVNode("strong", { children: "1-click install + app badge" })]
		}), createVNode("div", {
			style: `flex:1;text-align:center;color:${C.blue};border:1px dashed ${C.blue}66;border-radius:8px;padding:.45rem`,
			children: ["↳ on your tailnet → ", createVNode("strong", { children: "Reachable anywhere" })]
		})]
	})]
});
var states = [
	{
		c: C.amber,
		tag: "http:// (insecure)",
		title: "Pin it manually",
		body: "You're on http://box:7777. Use the browser menu (Create shortcut → Open as window) or Add to Home Screen. HTTPS via Tailscale adds one-click + a badge.",
		cta: "How → Reach it anywhere",
		solid: false
	},
	{
		c: C.green,
		tag: "https + Chromium",
		title: "Pin kolu to your dock",
		body: "Its own window, app icon, and a live badge for finished agents.",
		cta: "Install",
		solid: true
	},
	{
		c: C.blue,
		tag: "iOS Safari",
		title: "Add to Home Screen",
		body: "Tap Share ⬆ , then “Add to Home Screen”. (Instructions — iOS has no install button.)",
		cta: "Show me",
		solid: false
	}
];
var InstallStates = () => createVNode("div", {
	style: "display:grid;grid-template-columns:1fr 1fr 1fr;gap:.6rem;margin:1.4rem 0;max-width:40rem",
	children: states.map((s) => createVNode("div", {
		style: `border:1px solid ${s.c}55;border-radius:11px;background:${C.bg};overflow:hidden`,
		children: [createVNode("div", {
			style: `font:600 .56rem/1 ui-monospace,monospace;letter-spacing:.05em;text-transform:uppercase;color:${s.c};background:${s.c}1a;padding:.35rem .6rem;border-bottom:1px solid ${s.c}33`,
			children: s.tag
		}), createVNode("div", {
			style: "padding:.7rem .65rem",
			children: [
				createVNode("div", {
					style: `font:600 .78rem/1.25 ui-sans-serif,system-ui;color:${C.fg};margin-bottom:.3rem`,
					children: s.title
				}),
				createVNode("div", {
					style: `font:.66rem/1.45 ui-sans-serif,system-ui;color:${C.dim};min-height:3.2em`,
					children: s.body
				}),
				createVNode("div", {
					style: s.solid ? `margin-top:.55rem;text-align:center;font:600 .7rem/1 ui-sans-serif,system-ui;color:${C.bg};background:${s.c};border-radius:7px;padding:.4rem` : `margin-top:.55rem;text-align:center;font:600 .7rem/1 ui-sans-serif,system-ui;color:${s.c};border:1px solid ${s.c}66;border-radius:7px;padding:.4rem`,
					children: s.cta
				})
			]
		})]
	}))
});
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		br: "br",
		code: "code",
		em: "em",
		h2: "h2",
		h3: "h3",
		hr: "hr",
		li: "li",
		ol: "ol",
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
			"This note is the plan of record and build journal for kolu’s whole ",
			createVNode(_components.strong, { children: "first-run\nstory" }),
			", which spans three surfaces that turned out to be one:"
		] }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				"a ",
				createVNode(_components.strong, { children: "bird’s-eye in-app welcome" }),
				" — a revamp of the empty state, re-openable on\ndemand (",
				createVNode($$PrLink, { pr: 1199 }),
				");"
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"the ",
				createVNode(_components.strong, { children: "kolu.dev home page" }),
				", which started as a separate ",
				createVNode(_components.code, { children: "/welcome" }),
				" guide and\nwas later ",
				createVNode(_components.strong, { children: "folded in whole" }),
				" so a visitor understands kolu in one scroll\n(",
				createVNode($$PrLink, { pr: 1213 }),
				");"
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"a ",
				createVNode(_components.strong, { children: "hero demo clip" }),
				" at the top of that page — short, looping, and ",
				createVNode(_components.strong, { children: "filmed by\nthe e2e harness" }),
				" so it regenerates from source and can’t drift from the real\napp (",
				createVNode($$PrLink, { pr: 1213 }),
				")."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: "The first two thread around one verified insight (the spine). The third is its\nown subsystem with its own hard-won pipeline — both are below." }),
		"\n",
		createVNode(WelcomeMockup, {}),
		"\n",
		createVNode(_components.h2, {
			id: "the-spine-one-command-unlocks-two-features",
			children: "The spine: one command unlocks two features"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"kolu’s two onboarding goals — ",
			createVNode(_components.strong, { children: "pin it as an app" }),
			" and ",
			createVNode(_components.strong, { children: "reach it from\nanywhere" }),
			" — look separate. They are the same action."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"A self-hosted kolu is almost always served over ",
			createVNode(_components.strong, { children: "plain HTTP" }),
			" on a LAN\n(",
			createVNode(_components.code, { children: "192.168.x.x" }),
			") or Tailscale (",
			createVNode(_components.code, { children: "100.x" }),
			") address. You can still ",
			createVNode(_components.em, { children: "pin" }),
			" it from\nthere — Chrome’s ",
			createVNode(_components.em, { children: "Create shortcut → Open as window" }),
			" and iOS Safari’s ",
			createVNode(_components.em, { children: "Add to\nHome Screen" }),
			" both work over ",
			createVNode(_components.code, { children: "http://" }),
			" — but the ",
			createVNode(_components.strong, { children: "frictionless one-click install" }),
			"\n(the ",
			createVNode(_components.code, { children: "beforeinstallprompt" }),
			" prompt / omnibox install icon) and the ",
			createVNode(_components.strong, { children: "OS app\nbadge" }),
			" need a ",
			createVNode(_components.strong, { children: "secure context" }),
			" (HTTPS, or the loopback/",
			createVNode(_components.code, { children: "localhost" }),
			" set). The\nvery same ",
			createVNode(_components.code, { children: "tailscale serve" }),
			" that makes kolu reachable from your phone gives it a\nreal ",
			createVNode(_components.code, { children: "https://…ts.net" }),
			" origin — so it unlocks the ",
			createVNode(_components.strong, { children: "one-click" }),
			" install ",
			createVNode(_components.em, { children: "and" }),
			"\nremote access in ",
			createVNode(_components.strong, { children: "one command" }),
			". Tell it as one story."
		] }),
		"\n",
		"\n",
		"\n",
		createVNode(TailscaleBridge, {}),
		"\n",
		createVNode(_components.h3, {
			id: "verified-facts-the-plan-rests-on-these",
			children: "Verified facts (the plan rests on these)"
		}),
		"\n",
		createVNode(_components.p, { children: "Four load-bearing claims, each adversarially fact-checked against current\n(2025–26) primary sources." }),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "Plain HTTP: manual install works, one-click doesn't",
			children: [
				createVNode(_components.p, { children: [
					"Only the ",
					createVNode(_components.strong, { children: "automatic" }),
					" path needs a ",
					createVNode(_components.strong, { children: "secure context" }),
					"\n(",
					createVNode(_components.a, {
						href: "https://www.w3.org/TR/secure-contexts/",
						children: "W3C Secure Contexts §3.1"
					}),
					": HTTPS, or\nthe loopback/",
					createVNode(_components.code, { children: "localhost" }),
					" set). Over ",
					createVNode(_components.code, { children: "http://" }),
					" on a ",
					createVNode(_components.code, { children: "192.168.x.x" }),
					" LAN IP or a\nTailscale ",
					createVNode(_components.code, { children: "100.x" }),
					" IP, Chromium’s ",
					createVNode(_components.code, { children: "beforeinstallprompt" }),
					" / omnibox install icon\nwon’t fire, and the ",
					createVNode(_components.strong, { children: "OS app badge" }),
					" (Badging API) and ",
					createVNode(_components.strong, { children: "service workers" }),
					" are\nunavailable. ",
					createVNode(_components.em, { children: "That part is real." })
				] }),
				createVNode(_components.p, { children: [
					"But you can still ",
					createVNode(_components.strong, { children: "pin kolu manually" }),
					" over plain HTTP — the common self-hosted\ncase, and what most users actually do\n(",
					createVNode(_components.a, {
						href: "https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable",
						children: "MDN"
					}),
					",\n",
					createVNode(_components.a, {
						href: "https://web.dev/learn/pwa/installation",
						children: "web.dev"
					}),
					"):"
				] }),
				createVNode(_components.ul, { children: [
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: "Chrome / Edge desktop" }),
						": ⋮ → ",
						createVNode(_components.em, { children: "Save and share → Create shortcut…" }),
						" → tick ",
						createVNode(_components.strong, { children: "Open as window" }),
						" (a windowed app; no manifest install needed). ",
						createVNode(_components.em, { children: "Confirmed working on macOS Chrome over http." })
					] }),
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: "iOS Safari" }),
						": Share → ",
						createVNode(_components.strong, { children: "Add to Home Screen" }),
						" — no HTTPS requirement; launches standalone via the manifest’s ",
						createVNode(_components.code, { children: "display" }),
						". ",
						createVNode(_components.em, { children: "Confirmed working on iPhone Safari over http." })
					] }),
					"\n"
				] }),
				createVNode(_components.p, { children: [
					"So ",
					createVNode(_components.code, { children: "window.isSecureContext" }),
					" gates ",
					createVNode(_components.strong, { children: "which affordance to offer" }),
					", not ",
					createVNode(_components.strong, { children: "whether\ninstall is possible" }),
					": on an insecure origin, show ",
					createVNode(_components.strong, { children: "manual instructions" }),
					" (and\nrecommend HTTPS for the one-click prompt + app badge) — never a dead one-click\nbutton, and never ",
					createVNode(_components.em, { children: "“you can’t install.”" })
				] })
			]
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Tailscale Serve = a genuine secure context." }),
				" ",
				createVNode(_components.code, { children: "tailscale serve" }),
				" reverse-proxies a local port and terminates TLS at ",
				createVNode(_components.code, { children: "https://machine.tailnet.ts.net" }),
				" with a real ",
				createVNode(_components.strong, { children: "Let’s Encrypt" }),
				" cert (DNS-01 against ",
				createVNode(_components.code, { children: "*.ts.net" }),
				"; private key never leaves your box) — browsers accept it with no warnings, so install + service workers unlock. ",
				createVNode($$Pill, {
					variant: "ok",
					children: "confirmed"
				}),
				" Caveats: enable ",
				createVNode(_components.strong, { children: "MagicDNS + HTTPS Certificates" }),
				" once in the admin console; the ",
				createVNode(_components.strong, { children: "full FQDN" }),
				" is mandatory (the bare hostname and the ",
				createVNode(_components.code, { children: "100.x" }),
				" IP are still plain HTTP); Serve is ",
				createVNode(_components.strong, { children: "tailnet-only" }),
				"; the FQDN lands in public Certificate-Transparency logs, so don’t bake secrets into machine names. (",
				createVNode(_components.a, {
					href: "https://tailscale.com/kb/1312/serve",
					children: "Serve KB"
				}),
				", ",
				createVNode(_components.a, {
					href: "https://tailscale.com/kb/1153/enabling-https",
					children: "HTTPS KB"
				}),
				")"
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "beforeinstallprompt" }), " is Chromium-only."] }),
				" Chrome/Edge/Brave/etc. fire it; ",
				createVNode(_components.strong, { children: [
					"Firefox and Safari (desktop ",
					createVNode(_components.em, { children: "and" }),
					" iOS) never do"
				] }),
				" — and Chrome/Edge ",
				createVNode(_components.em, { children: "on iOS" }),
				" run on WebKit, so they don’t fire it either. A custom JS Install button must start ",
				createVNode(_components.strong, { children: "hidden" }),
				" and reveal only on the event. ",
				createVNode($$Pill, {
					variant: "ok",
					children: "confirmed"
				})
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "iOS has no install API." }),
				" The only path is the manual ",
				createVNode(_components.strong, { children: "Share → Add to Home Screen" }),
				", which works regardless of any event (since iOS 16.4 from Chrome/Edge/Firefox too, not just Safari). On iOS you render ",
				createVNode(_components.em, { children: "instructions, not a button" }),
				". Requires HTTPS + ",
				createVNode(_components.code, { children: "display: standalone" }),
				" + an ",
				createVNode(_components.code, { children: "apple-touch-icon" }),
				"; avoid the deprecated ",
				createVNode(_components.code, { children: "apple-mobile-web-app-capable" }),
				" meta. ",
				createVNode($$Pill, {
					variant: "ok",
					children: "confirmed"
				})
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "Manifest enrichment — shipped at the surface-app call site",
			children: createVNode(_components.p, { children: [
				"The manifest is served ",
				createVNode(_components.code, { children: "standalone" }),
				" with 192/512 icons, assembled by\n",
				createVNode(_components.code, { children: "@kolu/surface-app" }),
				"’s ",
				createVNode(_components.code, { children: "installPwaManifest" }),
				" (",
				createVNode($$PrLink, { pr: 1154 }),
				"), whose\n",
				createVNode(_components.code, { children: "...extra" }),
				" passthrough accepts the missing fields — so enriching it is just\npassing ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "description" }) }),
				" and a ",
				createVNode(_components.strong, { children: "maskable" }),
				" 512px icon (logo inside the safe\nzone on the brand background) at the call site\n(",
				createVNode($$Cite, {
					file: "packages/server/src/index.ts",
					lines: "254"
				}),
				"). ",
				createVNode(_components.em, { children: "No" }),
				" ",
				createVNode(_components.code, { children: "screenshots" }),
				":\nthey only prettify the install card (install works without them) and committed\nproduct shots go stale as the UI moves — not worth the maintenance. Validate via\n",
				createVNode(_components.strong, { children: "DevTools → Application → Manifest" }),
				" — Lighthouse’s PWA audit is deprecated."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "the-in-app-welcome",
			children: "The in-app welcome"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Revamp the empty state in place" }),
			" rather than add a modal — shipped as\n",
			createVNode($$Cite, { file: "packages/client/src/WelcomeMoments.tsx" }),
			" rendered above\n",
			createVNode($$Cite, { file: "packages/client/src/EmptyState.tsx" }),
			"’s restore card and shortcut\nlist. The patterns worth stealing: VS Code ",
			createVNode(_components.strong, { children: "Walkthroughs" }),
			" (a short,\nre-openable checklist — ",
			createVNode(_components.em, { children: "not" }),
			" a forced tour; it explicitly warns against\nexcessive steps), Warp (one welcome surface, success measured as ",
			createVNode(_components.em, { children: "habit" }),
			" not\ncompletion), Zed (empty-state-as-welcome, re-openable from the palette), and\nRaycast’s ",
			createVNode(_components.code, { children: "EmptyView" }),
			" (the empty state carries the onboarding ",
			createVNode(_components.em, { children: "with actions" }),
			")."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The moments (cap ~3–5, hard)." }),
			" The three cards above — ",
			createVNode(_components.strong, { children: "Pin it" }),
			",\n",
			createVNode(_components.strong, { children: "Reach it anywhere" }),
			", ",
			createVNode(_components.strong, { children: "Run agents" }),
			" — sit above the existing restore card and\nshortcut list. Each is one verb + one line + one chip; depth lives behind the\n“Full guide → kolu.dev” link, not inline. Lean on kolu’s auto-detection (recent\nrepos, recent agents in ",
			createVNode($$Cite, { file: "packages/client/src/wire.ts" }),
			") so the\nwelcome shows ",
			createVNode(_components.em, { children: "the user’s own data" }),
			", reinforcing zero-setup."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Re-openable via the palette." }),
			" The empty state only auto-shows at zero\nterminals, so the welcome would vanish forever once you’re working. A stable\npalette command — labelled ",
			createVNode(_components.strong, { children: "“Tutorial”" }),
			" (alias “Welcome”) — re-summons it\nanytime, mirroring VS Code’s ",
			createVNode(_components.code, { children: "openWalkthrough" }),
			". Wired as an action in\n",
			createVNode($$Cite, { file: "packages/client/src/input/actions.ts" }),
			" and surfaced through\n",
			createVNode($$Cite, { file: "packages/client/src/commands.tsx" }),
			"."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "No dismiss state — by design." }),
			" Zero terminals ",
			createVNode(_components.em, { children: "always" }),
			" shows the welcome.\nThe way you “dismiss” it is to ",
			createVNode(_components.strong, { children: "open a terminal" }),
			"; open zero again and it comes\nright back. There is no ",
			createVNode(_components.code, { children: "welcomeSeen" }),
			" flag, nothing to persist, nothing to go\nstale — the empty canvas ",
			createVNode(_components.em, { children: "is" }),
			" the trigger. The only addition is the ",
			createVNode(_components.strong, { children: "“Tutorial”" }),
			"\npalette command, with a feature-discoverability ",
			createVNode(_components.strong, { children: "tip" }),
			" pointing at it (per\n",
			createVNode($$Cite, { file: ".claude/rules/conventions.md" }),
			") so the re-open is discoverable."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "the-pwa-card-is-context-aware",
			children: "The PWA card is context-aware"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"This is where the spine pays off. The card reads the runtime and renders one of\nthree states — it ",
			createVNode(_components.strong, { children: "never" }),
			" shows a button that can’t work:"
		] }),
		"\n",
		"\n",
		"\n",
		createVNode(InstallStates, {}),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: "Gate order" }), " (apply top-down — the first match wins):"] }),
		"\n",
		createVNode(_components.pre, {
			class: "astro-code github-light",
			style: {
				backgroundColor: "#fff",
				color: "#24292e",
				overflowX: "auto"
			},
			tabindex: "0",
			"data-language": "plaintext",
			children: createVNode(_components.code, { children: [
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "1. already installed            → render nothing" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "     matchMedia('(display-mode: standalone)').matches" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "     || navigator.standalone === true" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "2. secure + beforeinstallprompt → real one-click Install button (Chromium)" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "3. secure, no event             → per-platform manual instructions (table below)" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "4. !window.isSecureContext      → manual-install instructions (browser menu /" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "     Add to Home Screen) + recommend HTTPS via Tailscale for one-click + badge" })
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: "Per-platform instruction set" }), " (render the literal glyph as inline SVG next to\nnumbered steps — visual beats prose):"] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Platform / browser" }),
					"\n",
					createVNode(_components.th, { children: "What kolu shows" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Chromium desktop / Android, event captured" }),
					"\n",
					createVNode(_components.td, { children: [
						"Real ",
						createVNode(_components.strong, { children: "Install" }),
						" button → ",
						createVNode(_components.code, { children: "prompt()" }),
						" in the click handler"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Android Chrome (no event)" }),
					"\n",
					createVNode(_components.td, { children: ["Menu ⋮ → ", createVNode(_components.strong, { children: "Install app" })] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Android Firefox" }),
					"\n",
					createVNode(_components.td, { children: [
						"Menu → ",
						createVNode(_components.strong, { children: "Install" }),
						" (no event, but install works)"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "iOS — Safari / Chrome / Edge / Firefox (16.4+)" }),
					"\n",
					createVNode(_components.td, { children: [
						"Illustrated ",
						createVNode(_components.strong, { children: "Share ⬆ → Add to Home Screen" }),
						" (instructions, not a button)"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Safari desktop (macOS Sonoma / Safari 17+)" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "File → Add to Dock" }), " (works on any page; no event)"] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Firefox desktop" }),
					"\n",
					createVNode(_components.td, { children: [
						"Native install not shipped yet (experimental ",
						createVNode(_components.em, { children: "Taskbar Tabs" }),
						") — suggest Chrome/Edge"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"Any non-secure origin (",
						createVNode(_components.code, { children: "http://" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"Manual-pin steps — Chrome ",
						createVNode(_components.em, { children: "Create shortcut → Open as window" }),
						", iOS ",
						createVNode(_components.em, { children: "Add to Home Screen" }),
						" — plus ",
						createVNode(_components.em, { children: "“HTTPS via Tailscale adds one-click + a badge.”" }),
						" Never a dead one-click button"
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "Library decision: use @khmyznikov/pwa-install, wrap thinly in Solid",
			children: createVNode(_components.p, { children: [
				"A ~28 kB, MIT, framework-agnostic web component (~41k weekly downloads, kept\ncurrent for iOS 18+) already solves the parts we’d otherwise re-implement: the\niOS/macOS Share-sheet instruction screens, localization, standalone detection,\none-shot ",
				createVNode(_components.code, { children: "prompt()" }),
				", and the ",
				createVNode(_components.code, { children: "appinstalled" }),
				" listener — matching kolu’s\n“prefer well-maintained libraries over custom code” rule\n(",
				createVNode($$Cite, { file: ".claude/rules/conventions.md" }),
				"). Wrap the custom element in a\nSolidJS component, feed it ",
				createVNode(_components.code, { children: "manifest-url" }),
				" / ",
				createVNode(_components.code, { children: "icon" }),
				" / ",
				createVNode(_components.code, { children: "install-description" }),
				", hand\nit the captured event via ",
				createVNode(_components.code, { children: "externalPromptEvent" }),
				", and read\n",
				createVNode(_components.code, { children: "isInstallAvailable" }),
				" / ",
				createVNode(_components.code, { children: "isUnderStandaloneMode" }),
				". Ship the wrapper as\n",
				createVNode(_components.code, { children: "@kolu/solid-pwa-install" }),
				", a focused adapter alongside ",
				createVNode(_components.code, { children: "solid-pierre" }),
				" /\n",
				createVNode(_components.code, { children: "solid-markdown" }),
				" / ",
				createVNode(_components.code, { children: "solid-fileview" }),
				", so the install card is reusable by other\nsurface apps (drishti included), not buried in kolu’s client.\n(",
				createVNode(_components.a, {
					href: "https://github.com/khmyznikov/pwa-install",
					children: "repo"
				}),
				")"
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "the-koludev-home-page",
			children: "The kolu.dev home page"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The full guide began as a separate ",
			createVNode(_components.code, { children: "website/src/pages/welcome.astro" }),
			" — a\nRaycast-style skill ladder, each section copy-pasteable and ending at a\nverifiable success state. It worked, but a second page split the story: the\nhome hero pointed at it, the visitor had to click through. So once the hero\n",
			createVNode(_components.strong, { children: "demo" }),
			" (next section) could carry the explaining, the guide was ",
			createVNode(_components.strong, { children: "folded into\nthe home page whole" }),
			" and ",
			createVNode(_components.code, { children: "/welcome" }),
			" deleted (",
			createVNode($$PrLink, { pr: 1213 }),
			"). The goal,\nstated plainly: ",
			createVNode(_components.em, { children: "the kolu.dev home page contains everything — you don’t need to\nnavigate elsewhere to understand kolu." })
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The home page (",
			createVNode($$Cite, { file: "website/src/pages/index.astro" }),
			") now runs:\n",
			createVNode(_components.strong, { children: "hero → the demo clip → features → the seven guide sections → latest post" }),
			",\nin one scroll. The sections keep their skill-ladder shape and stable anchors:"
		] }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Quickstart" }),
				" ",
				createVNode(_components.code, { children: "#quickstart" }),
				" — Nix install → running kolu; ends at ",
				createVNode(_components.em, { children: "“you should see kolu open with an empty canvas.”" })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "First 5 minutes" }),
				" ",
				createVNode(_components.code, { children: "#first" }),
				" — open a repo → launch an agent in a tile (mirrors in-app moment #3)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Core concepts" }),
				" ",
				createVNode(_components.code, { children: "#concepts" }),
				" — canvas, tiles, dock, worktrees, command/sub-palette, auto-detection."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Pin it as an app" }),
				" ",
				createVNode(_components.code, { children: "#install" }),
				" — the per-OS steps above, HTTP/secure-context caveat up front, Tailscale as the fix."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Reach it anywhere" }),
				" ",
				createVNode(_components.code, { children: "#remote" }),
				" — the minimal Tailscale sequence (below), the Serve-vs-Funnel safety note."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Power features" }),
				" ",
				createVNode(_components.code, { children: "#power" }),
				" — multi-agent at scale, keybindings, sessions."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "FAQ / Troubleshooting" }),
				" ",
				createVNode(_components.code, { children: "#faq" }),
				" — leads with ",
				createVNode(_components.em, { children: "“I see no Install button”" }),
				" → you’re on HTTP, use the ",
				createVNode(_components.code, { children: "ts.net" }),
				" URL."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Every in-app card and empty-state hint ",
			createVNode(_components.strong, { children: "deep-links to the matching anchor" }),
			" on\nthe home page — ",
			createVNode($$Cite, { file: "packages/client/src/WelcomeMoments.tsx" }),
			" points\n",
			createVNode(_components.code, { children: "GUIDE_URL" }),
			" at ",
			createVNode(_components.code, { children: "https://kolu.dev" }),
			" and links ",
			createVNode(_components.code, { children: "#remote" }),
			" etc. directly. This page\nstays the single source of truth, kept in sync with in-app copy and the README."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "The Tailscale walkthrough (the one to get exactly right)",
			children: [createVNode(_components.ol, { children: [
				"\n",
				createVNode(_components.li, { children: [
					"Install Tailscale on the dev box ",
					createVNode(_components.strong, { children: "and" }),
					" the phone/laptop; sign both into the ",
					createVNode(_components.strong, { children: "same account" }),
					".",
					createVNode(_components.br, {})
				] }),
				"\n",
				createVNode(_components.li, { children: [
					"Admin console → DNS: enable ",
					createVNode(_components.strong, { children: "MagicDNS" }),
					", then ",
					createVNode(_components.strong, { children: "HTTPS Certificates" }),
					" (one-time; acknowledge the public-ledger notice).",
					createVNode(_components.br, {})
				] }),
				"\n",
				createVNode(_components.li, { children: [
					"On the dev box: ",
					createVNode(_components.code, { children: "tailscale serve –bg <PORT>" }),
					" (",
					createVNode(_components.code, { children: "–bg" }),
					" survives reboots).",
					createVNode(_components.br, {})
				] }),
				"\n",
				createVNode(_components.li, { children: [
					"Open the printed ",
					createVNode(_components.code, { children: "https://<machine>.<tailnet>.ts.net" }),
					" on the phone — install the PWA from there."
				] }),
				"\n"
			] }), createVNode(_components.p, { children: [
				"Default to ",
				createVNode(_components.strong, { children: "Serve" }),
				" (tailnet-only), never ",
				createVNode(_components.strong, { children: "Funnel" }),
				" (public, no auth — a\nfootgun; a single flag flips a port public). Keep the dev server on\n",
				createVNode(_components.code, { children: "127.0.0.1" }),
				" and let Serve be the only exposed surface. Decision aid: Serve =\n“just my devices”; Cloudflare Tunnel + Access = “public + identity-gated”;\nngrok = “throwaway public URL”. Rule out Caddy local-CA / self-signed — its\nroot isn’t trusted on a remote phone, so no secure context."
			] })]
		}),
		"\n",
		createVNode(_components.h2, {
			id: "the-demo-that-films-itself",
			children: "The demo that films itself"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The guide tells you what kolu does in prose. The thing prose can’t carry is\n",
			createVNode(_components.strong, { children: "kolu actually doing it" }),
			" — so the top of the home page is a short, looping\nclip of a real kolu, ",
			createVNode(_components.strong, { children: "driven by the e2e harness and recorded off the screen" }),
			".\nA clip recorded by hand goes stale silently and can’t be refreshed when the UI\nmoves; this one is a ",
			createVNode(_components.strong, { children: "build artifact" }),
			", regenerated by ",
			createVNode(_components.code, { children: "just record hero-demo" }),
			",\nso it can’t drift from the app."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"One clip ships today — ",
			createVNode(_components.code, { children: "hero-demo" }),
			", the home hero — but the subsystem is built\nfor N. It’s one real workflow that exercises the whole surface at once: ",
			createVNode(_components.strong, { children: "click\n“+”" }),
			" to open claude on a cloned repo, ",
			createVNode(_components.strong, { children: "“+”" }),
			" again for codex on a second repo\nin a ",
			createVNode(_components.strong, { children: "light theme" }),
			" (Catppuccin Latte vs T1’s Vaughn) that buries the first\ntile — so the dock ",
			createVNode(_components.strong, { children: "groups two repos" }),
			" with live agent status — then ",
			createVNode(_components.strong, { children: "click\nclaude’s dock row" }),
			" to raise its tile, ",
			createVNode(_components.strong, { children: "open a file" }),
			", ",
			createVNode(_components.strong, { children: "select + comment" }),
			" on\nit, ",
			createVNode(_components.strong, { children: "copy the comment with the real button" }),
			", and hand it to claude, which\n",
			createVNode(_components.strong, { children: "edits the file" }),
			" with the change landing ",
			createVNode(_components.strong, { children: "live" }),
			" in the open source view. The\ncomment-on-any-file → agent → result loop, end to end."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "The as-built pipeline lives in the code + the Log",
			children: createVNode(_components.p, { children: [
				"The capture below is the ",
				createVNode(_components.strong, { children: "shipped" }),
				" design — an OS-level ",
				createVNode(_components.code, { children: "x11grab" }),
				" of a headful\nChrome app-mode window. It is ",
				createVNode(_components.em, { children: "not" }),
				" the first design (reuse Playwright\n",
				createVNode(_components.code, { children: "recordVideo" }),
				", fork at transcode); that one hit a hard fps-vs-resolution wall and\nwas thrown out. The full arc — dead-ends and all — is the ",
				createVNode(_components.strong, { children: "Log" }),
				" at the bottom;\nthe sources of truth are ",
				createVNode($$Cite, { file: "packages/tests/screencast/README.md" }),
				" and\n",
				createVNode($$Cite, { file: "packages/tests/screencast/engine.ts" }),
				" /\n",
				createVNode($$Cite, { file: "packages/tests/screencast/recordings" }),
				"."
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Crisp by construction." }),
			" The load-bearing constraint was “no low-quality\nnonsense,” and a screen clip has two quality ceilings. Capture ",
			createVNode(_components.strong, { children: "above display\nsize" }),
			": a headful Chrome at ",
			createVNode(_components.code, { children: "--force-device-scale-factor=2" }),
			" under ",
			createVNode(_components.code, { children: "Xvfb" }),
			", grabbed\nwith ",
			createVNode(_components.code, { children: "ffmpeg -f x11grab" }),
			" — ffmpeg samples the framebuffer on its ",
			createVNode(_components.strong, { children: "own fixed\nclock in physical pixels" }),
			", so it’s ",
			createVNode(_components.em, { children: "structurally" }),
			" smooth ",
			createVNode(_components.strong, { children: "and" }),
			" crisp at once\n(the thing no in-Chrome capture API could do). Then transcode audio-free, never\nGIF: an H.264 mp4 (",
			createVNode(_components.code, { children: "crf 18" }),
			" ≈ visually lossless for screen content) plus a VP9\nwebm (",
			createVNode(_components.code, { children: "crf 32" }),
			", served first because it’s smaller) plus an exact-frame WebP\nposter."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: [
				"A poster-first looping ",
				createVNode(_components.code, { children: "<video>" }),
				"."
			] }),
			" The asset lives at\n",
			createVNode(_components.code, { children: "website/public/demo/hero-demo.{mp4,webm,webp}" }),
			" (committed — Astro serves\n",
			createVNode(_components.code, { children: "public/" }),
			" directly, single-MB each) and embeds with the pattern every serious\ndev-tool site converges on:"
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
			"data-language": "html",
			children: createVNode(_components.code, { children: [
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#22863A" },
							children: "video"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " autoplay"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " muted"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " loop"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " playsinline"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " preload"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "="
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\"metadata\""
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " poster"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "="
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\"/demo/hero-demo.webp\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ">"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "  <"
						}),
						createVNode(_components.span, {
							style: { color: "#22863A" },
							children: "source"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " src"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "="
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\"/demo/hero-demo.webm\""
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " type"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "="
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\"video/webm\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " />  "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "<!-- VP9 first: smaller -->"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "  <"
						}),
						createVNode(_components.span, {
							style: { color: "#22863A" },
							children: "source"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " src"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "="
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\"/demo/hero-demo.mp4\""
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  type"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "="
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\"video/mp4\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "  />  "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "<!-- H.264 fallback -->"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "</"
						}),
						createVNode(_components.span, {
							style: { color: "#22863A" },
							children: "video"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ">"
						})
					]
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "muted" }),
			" (autoplay exemption), ",
			createVNode(_components.code, { children: "playsinline" }),
			" (or iOS forces fullscreen), ",
			createVNode(_components.strong, { children: [
				"webm\n",
				createVNode(_components.code, { children: "<source>" }),
				" first"
			] }),
			" (the browser takes the first decodable one), poster = frame 1\n(instant first paint, seamless swap). Gate autoplay on\n",
			createVNode(_components.code, { children: "prefers-reduced-motion: reduce" }),
			" — render the poster only, with a play control."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Reproducible, not hand-recorded." }),
			" The capture rides a seeded recording module:\ndeterministic clone names, pinned viewport / DPR / fonts, and — because the\nfinale ",
			createVNode(_components.em, { children: "edits a real checkout" }),
			" — ",
			createVNode(_components.code, { children: "ensureClone" }),
			" reverts tracked files\n(",
			createVNode(_components.code, { children: "git checkout -- ." }),
			") each run so the edit is always a fresh, visible change."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "Captured locally, not on a clean box — the honest seam",
			children: createVNode(_components.p, { children: [
				"Per do.md the clip is meant to film on a ",
				createVNode(_components.strong, { children: "pu box" }),
				"; it films ",
				createVNode(_components.strong, { children: "locally" }),
				" today\nbecause the demo’s climax launches a ",
				createVNode(_components.strong, { children: "real, authenticated agent" }),
				", and a clean\nbox has no logged-in CLI. So it’s ",
				createVNode(_components.strong, { children: "reproducible-from-source" }),
				" (the recipe +\nrecording modules run anywhere) but not box-pure — a deliberate, documented\nquality-over-purity tradeoff. (Claude Code’s banner prints your name/email/plan,\nbad for a public loop and unflaggable — so the identity-neutral half of the work\nruns ",
				createVNode(_components.strong, { children: "codex" }),
				", and claude’s banner is cropped out of frame.)"
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "architecture--through-the-electricity-lens",
			children: "Architecture — through the electricity lens"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Read against ",
			createVNode($$Cite, {
				file: "docs/atlas/src/content/atlas/electricity.mdx",
				label: "electricity.mdx"
			}),
			",\ninfrastructure that ① is domain-agnostic, ② hides a hard volatility, and ③\ngraduates to a second consumer earns its own ",
			createVNode(_components.code, { children: "@kolu/*" }),
			" package; everything else\nstays kolu domain. This work splits cleanly into electricity and domain on both\nthe welcome side and the screencast side."
		] }),
		"\n",
		createVNode($$D2, {
			caption: "The welcome surface across the domain line. Electricity (own packages, arrows pointing out): @kolu/surface-app owns the manifest + installability signals; @kolu/solid-pwa-install owns the install-card volatility, reading installability from surface-app; the agnostic web-screencast engine knows nothing of kolu. kolu DOMAIN (the in-app welcome + each recording) depends on all three. Outputs land on the home page.",
			code: `direction: down
surface: "@kolu/surface-app — manifest + installability signals (graduated)"
pwa: "@kolu/solid-pwa-install — install card + cross-browser volatility (publish?)"
screencast: "web-screencast engine — AGNOSTIC capture: Xvfb + app-mode Chrome + x11grab -> transcode (publish?)"
kolu: "kolu app — DOMAIN" {
welcome: "WelcomeMoments / EmptyState — 3 moments + install card + Tutorial cmd"
rec: "recordings/hero-demo.recording.ts — name, theme, viewport, drive(world)"
steplib: "step library / testids / shortcuts"
}
home: "website home — index.astro (#quickstart .. #faq) + /demo/hero-demo.{mp4,webm,webp}"
pwa -> surface: "reads canInstallPwa / isInstalled"
kolu.welcome -> pwa: "renders the card"
surface -> kolu.welcome: "installability signals"
kolu.rec -> screencast: "capture({chrome,size}, drive)"
kolu.rec -> kolu.steplib: "drive() uses"
screencast -> home: "demo assets"
kolu.welcome -> home: "deep-links #anchors"`
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: ["① ", createVNode(_components.code, { children: "@kolu/surface-app" })] }),
			" ",
			createVNode($$PrLink, { pr: 1154 }),
			" — the app-shell electricity. Owns\nthe ",
			createVNode(_components.strong, { children: "manifest" }),
			" (",
			createVNode(_components.code, { children: "installPwaManifest" }),
			", whose ",
			createVNode(_components.code, { children: "...extra" }),
			" passthrough absorbs the\nenrichment above) and the ",
			createVNode(_components.strong, { children: "headless “relationship-to-server” model" }),
			"\n(",
			createVNode(_components.code, { children: "useSurfaceApp()" }),
			"). ",
			createVNode(_components.em, { children: "Installability" }),
			" — ",
			createVNode(_components.code, { children: "window.isSecureContext" }),
			" + standalone\ndisplay-mode — is a sibling environment fact, so the ",
			createVNode(_components.code, { children: "canInstallPwa" }),
			" /\n",
			createVNode(_components.code, { children: "isInstalled" }),
			" signals belong in that same headless model. Graduates today\n(drishti is the second consumer)."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: ["② ", createVNode(_components.code, { children: "@kolu/solid-pwa-install" })] }),
			" — a focused SolidJS adapter wrapping\n",
			createVNode(_components.code, { children: "@khmyznikov/pwa-install" }),
			". Behind one socket (“install this web app”) it owns the\ncross-browser install volatility — ",
			createVNode(_components.code, { children: "beforeinstallprompt" }),
			" capture, the\nper-platform instruction screens, ",
			createVNode(_components.code, { children: "appinstalled" }),
			" — reading installability from\n①. ",
			createVNode(_components.strong, { children: [createVNode(_components.code, { children: "@kolu/surface-app" }), " may itself depend on it"] }),
			" and compose the card, so a\nconsumer wires install exactly once. Passes all three tests; graduates to any\nsurface app."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "③ The web-screencast engine" }),
			" — agnostic capture, a graduation candidate not\nyet electricity. “Drive a headful browser at 2× under Xvfb, ",
			createVNode(_components.code, { children: "x11grab" }),
			" the\nframebuffer, transcode to web assets” names no terminal/canvas/git; it hides a\nhard volatility (Xvfb lifecycle, app-mode launch, the fps-vs-resolution wall,\n",
			createVNode(_components.code, { children: "x11grab" }),
			"/ffmpeg flags, SIGINT finalize, the ",
			createVNode(_components.code, { children: "ffmpeg-full" }),
			" nix gotcha). It lives\nin its ",
			createVNode(_components.strong, { children: "own folder with the dependency arrow pointing out" }),
			"\n(",
			createVNode($$Cite, { file: "packages/tests/screencast/engine.ts" }),
			", nix deps in\n",
			createVNode(_components.code, { children: "screencast/shell.nix" }),
			"), flagged ",
			createVNode($$Pill, {
				variant: "run",
				children: "publish?"
			}),
			" — mint\n",
			createVNode(_components.code, { children: "@kolu/web-screencast" }),
			" only when a second consumer is real. The ",
			createVNode(_components.strong, { children: "recordings" }),
			"\n(",
			createVNode($$Cite, { file: "packages/tests/screencast/recordings" }),
			") are kolu domain: one file\nper clip declaring ",
			createVNode(_components.code, { children: "{ name, chrome, theme, display, viewport, drive(world) }" }),
			",\napplying kolu display knobs ",
			createVNode(_components.em, { children: "inside" }),
			" ",
			createVNode(_components.code, { children: "drive" }),
			" via kolu shortcuts. The engine\nexposes ",
			createVNode(_components.code, { children: "capture({ chrome, size }, drive)" }),
			" where ",
			createVNode(_components.code, { children: "drive(world)" }),
			" is a kolu-domain\nclosure — so the engine stays agnostic while each recording carries its own\ndeclarative display properties."
		] }),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: "④ kolu app" }), " — domain. The welcome itself is kolu’s story:"] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Area" }),
					"\n",
					createVNode(_components.th, { children: "File" }),
					"\n",
					createVNode(_components.th, { children: "Change" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "In-app welcome" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Cite, { file: "packages/client/src/WelcomeMoments.tsx" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"The 3 moments + the ",
						createVNode(_components.code, { children: "@kolu/solid-pwa-install" }),
						" card; ",
						createVNode(_components.code, { children: "GUIDE_URL" }),
						" → ",
						createVNode(_components.code, { children: "kolu.dev" }),
						" deep-links"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Re-open command" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$Cite, { file: "packages/client/src/input/actions.ts" }),
						", ",
						createVNode($$Cite, { file: "packages/client/src/commands.tsx" })
					] }),
					"\n",
					createVNode(_components.td, { children: "“Tutorial” action + palette entry — re-summons the welcome as an overlay" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Discoverability tip" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$Cite, { file: "packages/client/src/settings/tips.ts" }),
						", ",
						createVNode($$Cite, { file: "packages/client/src/settings/useTips.ts" })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"Tip pointing at “Tutorial”; drop the PWA tip on an insecure origin. ",
						createVNode(_components.strong, { children: "No" }),
						" ",
						createVNode(_components.code, { children: "welcomeSeen" })
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Manifest call-site" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Cite, {
						file: "packages/server/src/index.ts",
						lines: "254"
					}) }),
					"\n",
					createVNode(_components.td, { children: [
						"Pass ",
						createVNode(_components.code, { children: "description" }),
						" + maskable icon into ",
						createVNode(_components.code, { children: "installPwaManifest" })
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Home page" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Cite, { file: "website/src/pages/index.astro" }) }),
					"\n",
					createVNode(_components.td, { children: "The folded-in skill-ladder guide + the hero demo embed" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Recording" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Cite, { file: "packages/tests/screencast/recordings" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "hero-demo.recording.ts" }),
						" + shared ",
						createVNode(_components.code, { children: "helpers.ts" })
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: "No new server contract; no service worker (kolu has none by design)." }),
		"\n",
		createVNode(_components.h3, {
			id: "decisions",
			children: "Decisions"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "No persistence." }),
				" Zero terminals always shows the welcome; ",
				createVNode(_components.em, { children: "opening a terminal" }),
				" is the dismissal. No ",
				createVNode(_components.code, { children: "welcomeSeen" }),
				", nothing to go stale."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "One page, no redirect." }),
				" The ",
				createVNode(_components.code, { children: "/welcome" }),
				" guide folded into the home page whole — a visitor understands kolu in one scroll; in-app cards deep-link to its anchors."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Install ownership." }),
				" ",
				createVNode(_components.code, { children: "@kolu/solid-pwa-install" }),
				" owns the card UI + cross-browser volatility; ",
				createVNode(_components.code, { children: "@kolu/surface-app" }),
				" owns the manifest + installability signals and may depend on it — install is wired once."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Reuse the e2e harness for capture" }), " — the same step library that proves kolu works films it; no second recorder."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Move the capture boundary outside Chrome" }),
				" — ",
				createVNode(_components.code, { children: "Xvfb" }),
				" + ",
				createVNode(_components.code, { children: "x11grab" }),
				" of a headful 2× app-mode window; structurally smooth ",
				createVNode(_components.em, { children: "and" }),
				" crisp, which no in-Chrome API delivered."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Fork at transcode, never GIF" }),
				" — H.264 mp4 + VP9 webm + WebP poster, committed under ",
				createVNode(_components.code, { children: "website/public/demo/" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Tailscale: instruct, never auto-run." }),
				" The welcome documents ",
				createVNode(_components.code, { children: "tailscale serve" }),
				"; it never runs it for you. Serve, never Funnel. No QR — a copy button on the ",
				createVNode(_components.code, { children: "ts.net" }),
				" URL is enough."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "No mobile welcome." }),
				" Onboarding is desktop-only (",
				createVNode($$Cite, {
					file: "packages/client/src/capabilities.ts",
					lines: "34"
				}),
				")."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "pitfalls",
			children: "Pitfalls"
		}),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "The traps, condensed",
			children: createVNode(_components.ul, { children: [
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: "Dead Install buttons on HTTP." }),
					" The #1 kolu-specific trap — gate on ",
					createVNode(_components.code, { children: "isSecureContext" }),
					" first, always; default-visible custom Install buttons break on Safari/Firefox/iOS (no event); the iOS card is ",
					createVNode(_components.em, { children: "instructions" }),
					", not a button."
				] }),
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: [
						"Funnel by default, or the bare hostname / ",
						createVNode(_components.code, { children: "100.x" }),
						" IP."
					] }),
					" Funnel is public+unauthenticated; the bare host and IP are plain HTTP. Always the full ",
					createVNode(_components.code, { children: "ts.net" }),
					" FQDN, Serve not Funnel."
				] }),
				"\n",
				createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Long forced tours / replaying onboarding for returning users." }), " One win, then links; zero terminals re-shows the welcome, but never hand-hold."] }),
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: [
						createVNode(_components.code, { children: "ffmpeg" }),
						", not ",
						createVNode(_components.code, { children: "ffmpeg-full" }),
						"."
					] }),
					" Plain nixpkgs ffmpeg is built ",
					createVNode(_components.code, { children: "--disable-xlib" }),
					" — no x11grab device. Fonts must be supplied to the capture Chrome under bare Xvfb (keep them free-licensed — ",
					createVNode(_components.code, { children: "symbola" }),
					" is unfree and fails the build)."
				] }),
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: "Transcoding a soft source and calling it crisp." }),
					" 1 Mbit/s VP8 (",
					createVNode(_components.code, { children: "recordVideo" }),
					") is a ceiling ffmpeg can’t recover; capture lossless at 2× instead."
				] }),
				"\n",
				createVNode(_components.li, { children: [createVNode(_components.strong, { children: [
					"Poll the dock’s ",
					createVNode(_components.code, { children: "data-bucket" }),
					", not the raw ",
					createVNode(_components.code, { children: "data-agent-state" })
				] }), " — the high-level “working”/“awaiting” state; polling the wrong one made clips run 70–150s."] }),
				"\n"
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "log--build-journal",
			children: "Log — build journal"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"A running record of ",
			createVNode(_components.em, { children: "this work’s" }),
			" research, dead-ends, and decisions — raw\nmaterial for a future blog post. The in-app welcome + the kolu.dev guide shipped\nin ",
			createVNode($$PrLink, { pr: 1199 }),
			"; the guide later folded into the home page alongside the\nhero demo in ",
			createVNode($$PrLink, { pr: 1213 }),
			". The screencast arc, newest at the bottom:"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "1 · Plan + prior-art sweep." }),
			" ",
			createVNode($$Pill, {
				variant: "ok",
				children: "workflow #1"
			}),
			" A fan-out\nresearch workflow (terminal recorders vs browser capture · embed patterns · CI\ndeterminism), adversarially verified, concluded: PTY recorders (vhs, asciinema)\n",
			createVNode(_components.strong, { children: "can’t" }),
			" capture kolu’s xterm-on-canvas pixels — it’s a raster GUI, not a\nreplayable ANSI stream — so ",
			createVNode(_components.strong, { children: "pixel capture via the existing Cucumber +\nPlaywright evidence harness" }),
			" is the path. Embed pattern: poster-first\n",
			createVNode(_components.code, { children: "autoplay/muted/loop/playsinline" }),
			", mp4 + webm, reduced-motion."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "2 · The crispness constraint." }),
			" “Video needs to be crisp — no low-quality\nnonsense.” This became the spine. The evidence path records Playwright\n",
			createVNode(_components.code, { children: "recordVideo" }),
			" = ",
			createVNode(_components.strong, { children: "VP8 @ ~1 Mbit/s, 720p" }),
			" — fine for PR proof, too soft for a\nmarketing page."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "3 · Spike A (VP8)." }),
			" Reused the harness (",
			createVNode(_components.code, { children: "KOLU_EVIDENCE" }),
			") on a real\n",
			createVNode(_components.code, { children: "worktree-agent" }),
			" scenario → 1280×720 VP8 → ffmpeg H.264. Smooth, but the text\nshimmered. Verdict: “could be crispier.”"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "4 · The fps-vs-resolution wall." }),
			" Chasing 2×, every in-Chrome capture API hit a\nstructural limit: CDP ",
			createVNode(_components.code, { children: "Page.startScreencast" }),
			" ",
			createVNode(_components.strong, { children: ["ignores ", createVNode(_components.code, { children: "deviceScaleFactor" })] }),
			" →\ncaps at CSS pixels; ",
			createVNode(_components.code, { children: "Page.captureScreenshot" }),
			" ",
			createVNode(_components.em, { children: "can" }),
			" do 2× but each 2560×1440 grab\nis ",
			createVNode(_components.strong, { children: "compositor-bound at ~260 ms" }),
			" → ~3 fps ",
			createVNode(_components.strong, { children: "slideshow" }),
			"; ",
			createVNode(_components.code, { children: "page.screenshot()" }),
			"\n",
			createVNode(_components.strong, { children: "serialises behind the driver" }),
			" → ~10 frames over a 4 s scenario; a capture loop\nthat started before load made frame 0 a blank white flash that strobed on every\nloop. ",
			createVNode(_components.strong, { children: "The lesson:" }),
			" real-time frame capture is ",
			createVNode(_components.em, { children: "either" }),
			" smooth-but-low-res ",
			createVNode(_components.em, { children: "or" }),
			"\nhigh-res-but-too-slow. You can’t win it from inside Chrome."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "5 · Reset + second research pass." }),
			" ",
			createVNode($$Pill, {
				variant: "ok",
				children: "workflow #2"
			}),
			" A\nsecond fan-out (virtual-time ",
			createVNode(_components.code, { children: "beginFrame" }),
			" · OS-level capture · purpose-built\nrecorders · native Playwright options), adversarially verified. ",
			createVNode(_components.strong, { children: "Verdict: move\nthe capture boundary outside Chrome" }),
			" — ",
			createVNode(_components.code, { children: "Xvfb" }),
			" + ",
			createVNode(_components.code, { children: "ffmpeg -f x11grab" }),
			" of a headful\n2× browser samples the framebuffer on its own fixed clock in physical pixels, so\nit’s ",
			createVNode(_components.em, { children: "structurally" }),
			" smooth ",
			createVNode(_components.strong, { children: "and" }),
			" crisp at once. Also surfaced: ",
			createVNode(_components.strong, { children: "no top dev\ntool ships an auto-captured hero clip — they’re “designed, not recorded”" }),
			" (Screen\nStudio etc.). We deliberately take the reproducible-over-cinematic path."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "6 · x11grab, working." }),
			" Implemented ",
			createVNode(_components.code, { children: "KOLU_X11CAP" }),
			": Xvfb, headful Chrome at\n",
			createVNode(_components.code, { children: "--force-device-scale-factor=2" }),
			", ",
			createVNode(_components.code, { children: "ffmpeg -f x11grab" }),
			" at 30 fps, ",
			createVNode(_components.strong, { children: "SIGINT" }),
			" to\nflush the moov atom. Gotcha that cost a cycle: nixpkgs ",
			createVNode(_components.code, { children: "ffmpeg" }),
			" is built\n",
			createVNode(_components.code, { children: "--disable-xlib" }),
			" (",
			createVNode(_components.strong, { children: "no x11grab device" }),
			" — “Unrecognized option ‘draw_mouse’”) →\nswitched the e2e devShell to ",
			createVNode(_components.code, { children: "ffmpeg-full" }),
			". Result: smooth + crisp. “B looks\ngood.”"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "7 · The browser-chrome realisation." }),
			" x11grab records the ",
			createVNode(_components.em, { children: "whole window" }),
			" — the\nclip showed Chrome’s tab strip + ",
			createVNode(_components.code, { children: "localhost:38425" }),
			" address bar. Reads as “a\nbrowser tab,” not “the app.” Fix: ",
			createVNode(_components.strong, { children: [
				"Chrome app-mode (",
				createVNode(_components.code, { children: "--app=<url>" }),
				")"
			] }),
			" = the\nchromeless window an installed PWA uses."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "8 · Scope crystallised into a subsystem." }),
			" A lowy/hickey-clean ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "Recording" }) }),
			"\nabstraction — data + script per clip, separate from the capture pipeline. The\nengine stays agnostic; recordings carry the kolu-specific display knobs."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "9 · Subsystem shipped." }),
			" ",
			createVNode($$PrLink, { pr: 1213 }),
			" The agnostic engine\n(",
			createVNode($$Cite, { file: "packages/tests/screencast/engine.ts" }),
			", nix deps in\n",
			createVNode(_components.code, { children: "screencast/shell.nix" }),
			"), the ",
			createVNode(_components.code, { children: "Recording" }),
			" modules, a ",
			createVNode(_components.code, { children: "When I record \"<name>\"" }),
			"\ndispatcher, and a ",
			createVNode(_components.code, { children: "just record" }),
			" recipe. Captured ",
			createVNode(_components.strong, { children: "locally" }),
			", not on pu: the\ndemo’s climax launches a ",
			createVNode(_components.strong, { children: "real, authenticated agent" }),
			", so it only renders on a\nmachine already running it — a deliberate, documented tradeoff (quality >\nbox-purity; reproducibility lives in the recipe + modules, which ",
			createVNode(_components.em, { children: "do" }),
			" run on pu)."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "10 · Refined to one hero clip." }),
			" Dropped a planned ",
			createVNode(_components.strong, { children: "pwa-install" }),
			" recording —\nan in-clip browser→app transition isn’t reachable (bare Xvfb has no window\nmanager, so the Fullscreen API can’t drop Chrome’s chrome). Two harness fixes\nmade the dock track the live agent: under ",
			createVNode(_components.code, { children: "KOLU_X11CAP" }),
			", omit the\n",
			createVNode(_components.code, { children: "KOLU_CLAUDE_*_DIR" }),
			" / ",
			createVNode(_components.code, { children: "KOLU_CODEX_DIR" }),
			" overrides so kolu watches the ",
			createVNode(_components.strong, { children: "real" }),
			"\nagent dirs; and a 240s timeout on the ",
			createVNode(_components.code, { children: "I record" }),
			" step (a real agent query exceeds\nthe default budget). The dock’s high-level state is ",
			createVNode(_components.code, { children: "data-bucket" }),
			"\n(“working”/“awaiting”), ",
			createVNode(_components.strong, { children: "not" }),
			" the raw ",
			createVNode(_components.code, { children: "data-agent-state" }),
			" — polling the wrong\none made clips run 70–150s."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "11 · Polish → the comprehensive hero." }),
			" Privacy: Claude Code’s banner prints\nname/email/plan, so the identity-neutral half runs ",
			createVNode(_components.strong, { children: "codex" }),
			"\n(",
			createVNode(_components.code, { children: "--ask-for-approval never --sandbox read-only" }),
			"; the ",
			createVNode(_components.code, { children: "--dangerously-bypass…" }),
			"\ninteractive mode shows a danger-confirm the prompt dismisses → codex exits) and\nclaude’s banner is cropped. The app-mode session auto-restores a terminal, so\nthe recording ",
			createVNode(_components.code, { children: "killAll" }),
			"s it for an empty opening canvas, then creates one\n",
			createVNode(_components.strong, { children: "Vaughn" }),
			"-themed terminal on camera, ",
			createVNode(_components.code, { children: "trimStart" }),
			" skipping the load-in. The clip\ngrew into the full ",
			createVNode(_components.strong, { children: "comment → agent → live-edit" }),
			" loop across two repos and two\nthemes — every on-camera click telegraphed with a coral SVG arrow (the earlier\nglowing ring read as kolu’s own UI), sub-second pauses, and a held beat after the\ndock flips to ",
			createVNode(_components.code, { children: "awaiting" }),
			" so the status change is unmissable. ~45s, 3200×1800\n(1600×900 ×2), ~3.9 MB mp4 / ~2.9 MB webm. Reusable patterns factored into\n",
			createVNode(_components.code, { children: "helpers.ts" }),
			"."
		] }),
		"\n",
		createVNode(_components.hr, {}),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.em, { children: [
			"Status: ",
			createVNode(_components.code, { children: "implemented" }),
			" — the welcome revamp in ",
			createVNode($$PrLink, { pr: 1199 }),
			"; the hero\ndemo + the folded-in home page in ",
			createVNode($$PrLink, { pr: 1213 }),
			"; built on\n",
			createVNode(_components.code, { children: "@kolu/surface-app" }),
			" ",
			createVNode($$PrLink, { pr: 1154 }),
			"."
		] }) })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "Welcome, revamped — pin it, reach it, run agents, watch it",
	"description": "One story across three surfaces — a bird's-eye in-app welcome, the kolu.dev home page that now carries the whole guide, and a hero demo clip filmed by the e2e harness so it can't drift from the real app. The spine — one `tailscale serve` gives kolu both the HTTPS secure context for one-click PWA install and remote reach. Plan of record + build journal.",
	"parents": ["video-evidence", "feature"],
	"status": "implemented",
	"maturity": "budding",
	"updated": "2026-06-10T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "the-spine-one-command-unlocks-two-features",
			"text": "The spine: one command unlocks two features"
		},
		{
			"depth": 3,
			"slug": "verified-facts-the-plan-rests-on-these",
			"text": "Verified facts (the plan rests on these)"
		},
		{
			"depth": 2,
			"slug": "the-in-app-welcome",
			"text": "The in-app welcome"
		},
		{
			"depth": 3,
			"slug": "the-pwa-card-is-context-aware",
			"text": "The PWA card is context-aware"
		},
		{
			"depth": 2,
			"slug": "the-koludev-home-page",
			"text": "The kolu.dev home page"
		},
		{
			"depth": 2,
			"slug": "the-demo-that-films-itself",
			"text": "The demo that films itself"
		},
		{
			"depth": 2,
			"slug": "architecture--through-the-electricity-lens",
			"text": "Architecture — through the electricity lens"
		},
		{
			"depth": 3,
			"slug": "decisions",
			"text": "Decisions"
		},
		{
			"depth": 3,
			"slug": "pitfalls",
			"text": "Pitfalls"
		},
		{
			"depth": 2,
			"slug": "log--build-journal",
			"text": "Log — build journal"
		}
	];
}
var url = "src/content/atlas/welcome-revamp.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/welcome-revamp.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/welcome-revamp.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Arrow, C, Content, Content as default, InstallStates, Node, TailscaleBridge, WelcomeMockup, Win, file, frontmatter, getHeadings, moments, states, url };
