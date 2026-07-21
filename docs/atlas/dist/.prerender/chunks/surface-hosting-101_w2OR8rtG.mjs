import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Svg } from "./Svg_DjauMHvD.mjs";
import { t as $$Footnote } from "./Footnote_D9yrIxmz.mjs";
//#region src/diagrams/surface-hosting-101-map.svg?raw
var surface_hosting_101_map_default = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 960 540\" font-family=\"inherit\" role=\"img\" aria-label=\"The surface framework hosting side: kolu one-bound-host story on top, drishti fleet story below, shared framework packages in the middle\"><defs><marker id=\"ar\" viewBox=\"0 0 8 8\" refX=\"7\" refY=\"4\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\"><path d=\"M 0 0 L 8 4 L 0 8 z\" fill=\"currentColor\" opacity=\"0.7\"/></marker></defs><text x=\"28\" y=\"34\" font-size=\"10\" letter-spacing=\"1.5\" fill=\"currentColor\" opacity=\"0.6\" style=\"text-transform:uppercase\">kolu — one canvas, bound to ONE host at a time</text><rect x=\"28\" y=\"48\" width=\"150\" height=\"86\" rx=\"8\" fill=\"#3b82f6\" fill-opacity=\"0.1\" stroke=\"#3b82f6\" stroke-width=\"1.4\"/><text x=\"103.0\" y=\"66\" text-anchor=\"middle\" font-size=\"12\" font-weight=\"700\" fill=\"currentColor\">browser tab</text><text x=\"103.0\" y=\"82\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.8\">the canvas UI</text><text x=\"103.0\" y=\"95\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.8\">.use() hooks (Solid)</text><text x=\"103.0\" y=\"108\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.8\">ONE websocket</text><rect x=\"258\" y=\"48\" width=\"240\" height=\"86\" rx=\"8\" fill=\"#3b82f6\" fill-opacity=\"0.1\" stroke=\"#3b82f6\" stroke-width=\"1.4\"/><text x=\"378.0\" y=\"66\" text-anchor=\"middle\" font-size=\"12\" font-weight=\"700\" fill=\"currentColor\">kolu-server</text><text x=\"378.0\" y=\"82\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.8\">reServeSurface = mirror + serve</text><text x=\"378.0\" y=\"95\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.8\">holds a live COPY of padiSurface</text><text x=\"378.0\" y=\"108\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.8\">forwards writes upstream</text><rect x=\"578\" y=\"48\" width=\"180\" height=\"86\" rx=\"8\" fill=\"#3b82f6\" fill-opacity=\"0.1\" stroke=\"#3b82f6\" stroke-width=\"1.4\"/><text x=\"668.0\" y=\"66\" text-anchor=\"middle\" font-size=\"12\" font-weight=\"700\" fill=\"currentColor\">padi  (on the host)</text><text x=\"668.0\" y=\"82\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.8\">owns the terminal workspace</text><text x=\"668.0\" y=\"95\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.8\">serves padiSurface</text><text x=\"668.0\" y=\"108\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.8\">+ the frozen control core</text><rect x=\"818\" y=\"48\" width=\"114\" height=\"86\" rx=\"8\" fill=\"#3b82f6\" fill-opacity=\"0.1\" stroke=\"#3b82f6\" stroke-width=\"1.4\"/><text x=\"875.0\" y=\"66\" text-anchor=\"middle\" font-size=\"12\" font-weight=\"700\" fill=\"currentColor\">kaval</text><text x=\"875.0\" y=\"82\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.8\">the PTYs</text><text x=\"875.0\" y=\"95\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.8\">(your shells</text><text x=\"875.0\" y=\"108\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.8\">live here)</text><path d=\"M 178 91 L 250 91\" stroke=\"currentColor\" stroke-width=\"1.4\" fill=\"none\" opacity=\"0.7\" marker-end=\"url(#ar)\"/><text x=\"218.0\" y=\"85.0\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"currentColor\" opacity=\"0.75\">one socket</text><path d=\"M 498 91 L 570 91\" stroke=\"currentColor\" stroke-width=\"1.4\" fill=\"none\" opacity=\"0.7\" marker-end=\"url(#ar)\"/><text x=\"538.0\" y=\"85.0\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"currentColor\" opacity=\"0.75\">a session dials it</text><path d=\"M 758 91 L 810 91\" stroke=\"currentColor\" stroke-width=\"1.4\" fill=\"none\" opacity=\"0.7\" marker-end=\"url(#ar)\"/><rect x=\"258\" y=\"158\" width=\"240\" height=\"92\" rx=\"8\" fill=\"#c08a2d\" fill-opacity=\"0.1\" stroke=\"#c08a2d\" stroke-width=\"1.4\"/><text x=\"378.0\" y=\"176\" text-anchor=\"middle\" font-size=\"12\" font-weight=\"700\" fill=\"currentColor\">the session (BoundPadi role)</text><text x=\"378.0\" y=\"192\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.8\">&quot;can hand me a live client +</text><text x=\"378.0\" y=\"205\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.8\">tell me connection state&quot;</text><text x=\"378.0\" y=\"218\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.8\">local arm: unix socket</text><text x=\"378.0\" y=\"231\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.8\">remote arm: wraps HostSession (ssh)</text><path d=\"M 378 158 L 370 134\" stroke=\"currentColor\" stroke-width=\"1.4\" fill=\"none\" opacity=\"0.7\" marker-end=\"url(#ar)\"/><text x=\"28\" y=\"296\" font-size=\"10\" letter-spacing=\"1.5\" fill=\"currentColor\" opacity=\"0.6\" style=\"text-transform:uppercase\">the shared framework (the electricity — both apps run on it)</text><rect x=\"28\" y=\"308\" width=\"286\" height=\"72\" rx=\"8\" fill=\"#22a06b\" fill-opacity=\"0.1\" stroke=\"#22a06b\" stroke-width=\"1.4\"/><text x=\"171.0\" y=\"326\" text-anchor=\"middle\" font-size=\"12\" font-weight=\"700\" fill=\"currentColor\">@kolu/surface</text><text x=\"171.0\" y=\"342\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.8\">the contract + serve + mirror</text><text x=\"171.0\" y=\"355\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.8\">cells · collections · procedures · streams</text><rect x=\"334\" y=\"308\" width=\"286\" height=\"72\" rx=\"8\" fill=\"#22a06b\" fill-opacity=\"0.1\" stroke=\"#22a06b\" stroke-width=\"1.4\"/><text x=\"477.0\" y=\"326\" text-anchor=\"middle\" font-size=\"12\" font-weight=\"700\" fill=\"currentColor\">@kolu/surface-app</text><text x=\"477.0\" y=\"342\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.8\">Solid hooks over a client</text><text x=\"477.0\" y=\"355\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.8\">(today: ONE static client per app)</text><rect x=\"640\" y=\"308\" width=\"292\" height=\"72\" rx=\"8\" fill=\"#22a06b\" fill-opacity=\"0.1\" stroke=\"#22a06b\" stroke-width=\"1.4\"/><text x=\"786.0\" y=\"326\" text-anchor=\"middle\" font-size=\"12\" font-weight=\"700\" fill=\"currentColor\">@kolu/surface-nix-host</text><text x=\"786.0\" y=\"342\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.8\">HostSession (ssh+Nix, a CLASS)</text><text x=\"786.0\" y=\"355\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.8\">reServeSurface · buildHostRegistry</text><text x=\"28\" y=\"424\" font-size=\"10\" letter-spacing=\"1.5\" fill=\"currentColor\" opacity=\"0.6\" style=\"text-transform:uppercase\">drishti — a FLEET: many hosts at once (the second consumer)</text><rect x=\"28\" y=\"436\" width=\"150\" height=\"80\" rx=\"8\" fill=\"#a855f7\" fill-opacity=\"0.1\" stroke=\"#a855f7\" stroke-width=\"1.4\"/><text x=\"103.0\" y=\"454\" text-anchor=\"middle\" font-size=\"12\" font-weight=\"700\" fill=\"currentColor\">drishti web</text><text x=\"103.0\" y=\"470\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.8\">fleet dashboard</text><text x=\"103.0\" y=\"483\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.8\">?host=zest picks</text><text x=\"103.0\" y=\"496\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.8\">which machine</text><rect x=\"258\" y=\"436\" width=\"240\" height=\"80\" rx=\"8\" fill=\"#a855f7\" fill-opacity=\"0.1\" stroke=\"#a855f7\" stroke-width=\"1.4\"/><text x=\"378.0\" y=\"454\" text-anchor=\"middle\" font-size=\"12\" font-weight=\"700\" fill=\"currentColor\">buildHostRegistry</text><text x=\"378.0\" y=\"470\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.8\">Map: host → { session · handler }</text><text x=\"378.0\" y=\"483\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.8\">dispatches each socket by ?host=</text><text x=\"378.0\" y=\"496\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.8\">add / remove / reconnect (fleet)</text><rect x=\"578\" y=\"436\" width=\"160\" height=\"80\" rx=\"8\" fill=\"#a855f7\" fill-opacity=\"0.1\" stroke=\"#a855f7\" stroke-width=\"1.4\"/><text x=\"658.0\" y=\"454\" text-anchor=\"middle\" font-size=\"12\" font-weight=\"700\" fill=\"currentColor\">HostSession × N</text><text x=\"658.0\" y=\"470\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.8\">one per machine</text><text x=\"658.0\" y=\"483\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.8\">provision + ssh</text><text x=\"658.0\" y=\"496\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.8\">reconnect · give-up</text><rect x=\"798\" y=\"436\" width=\"134\" height=\"80\" rx=\"8\" fill=\"#a855f7\" fill-opacity=\"0.1\" stroke=\"#a855f7\" stroke-width=\"1.4\"/><text x=\"865.0\" y=\"454\" text-anchor=\"middle\" font-size=\"12\" font-weight=\"700\" fill=\"currentColor\">agents @ hosts</text><text x=\"865.0\" y=\"470\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.8\">remote daemons</text><text x=\"865.0\" y=\"483\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.8\">mirrored home</text><path d=\"M 178 476 L 250 476\" stroke=\"currentColor\" stroke-width=\"1.4\" fill=\"none\" opacity=\"0.7\" marker-end=\"url(#ar)\"/><text x=\"218.0\" y=\"470.0\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"currentColor\" opacity=\"0.75\">?host=</text><path d=\"M 498 476 L 570 476\" stroke=\"currentColor\" stroke-width=\"1.4\" fill=\"none\" opacity=\"0.7\" marker-end=\"url(#ar)\"/><text x=\"538.0\" y=\"470.0\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"currentColor\" opacity=\"0.75\">session per host</text><path d=\"M 738 476 L 790 476\" stroke=\"currentColor\" stroke-width=\"1.4\" fill=\"none\" opacity=\"0.7\" marker-end=\"url(#ar)\"/><text x=\"768.0\" y=\"470.0\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"currentColor\" opacity=\"0.75\">ssh</text><path d=\"M 378 308 L 370 254\" stroke=\"currentColor\" stroke-width=\"1.4\" fill=\"none\" opacity=\"0.7\" marker-end=\"url(#ar)\" stroke-dasharray=\"4 3\"/><path d=\"M 378 436 L 370 384\" stroke=\"currentColor\" stroke-width=\"1.4\" fill=\"none\" opacity=\"0.7\" marker-end=\"url(#ar)\" stroke-dasharray=\"4 3\"/><text x=\"392\" y=\"278\" font-size=\"9\" fill=\"currentColor\" opacity=\"0.6\">both stories are built from these parts</text></svg>";
//#endregion
//#region src/diagrams/surface-hosting-101-roles.svg?raw
var surface_hosting_101_roles_default = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 980 560\" font-family=\"inherit\" role=\"img\" aria-label=\"How the session pieces relate: one role at the top, implementations below it, kolu's extension beside, and the two framework consumers at the bottom — one of which wrongly names the class\"><defs><marker id=\"m1\" viewBox=\"0 0 8 8\" refX=\"7\" refY=\"4\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\"><path d=\"M 0 0 L 8 4 L 0 8 z\" fill=\"currentColor\" opacity=\"0.75\"/></marker></defs><rect x=\"330\" y=\"22\" width=\"320\" height=\"86\" rx=\"9\" fill=\"#22a06b\" fill-opacity=\"0.1\" stroke=\"#22a06b\" stroke-width=\"1.5\" stroke-dasharray=\"6 4\"/><text x=\"490.0\" y=\"41\" text-anchor=\"middle\" font-size=\"12.5\" font-weight=\"700\" fill=\"currentColor\">RemoteMirrorSession — the ROLE</text><text x=\"490.0\" y=\"57\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">an interface: the PLUG SHAPE, nothing runs</text><text x=\"490.0\" y=\"70\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">pin() · currentClient() · onState() · destroy()</text><text x=\"490.0\" y=\"83\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">&quot;hand me a live client + tell me the pipe&#x27;s state&quot;</text><rect x=\"60\" y=\"190\" width=\"270\" height=\"104\" rx=\"9\" fill=\"#a855f7\" fill-opacity=\"0.12\" stroke=\"#a855f7\" stroke-width=\"1.5\"/><text x=\"195.0\" y=\"209\" text-anchor=\"middle\" font-size=\"12.5\" font-weight=\"700\" fill=\"currentColor\">HostSession — a CLASS</text><text x=\"195.0\" y=\"225\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">the ssh+Nix appliance that FITS the plug:</text><text x=\"195.0\" y=\"238\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">provision binary → run over ssh →</text><text x=\"195.0\" y=\"251\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">reconnect w/ backoff → give up loudly</text><text x=\"195.0\" y=\"264\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">drishti holds N of these (its fleet)</text><path d=\"M 195 190 L 420 112\" stroke=\"currentColor\" stroke-width=\"1.4\" fill=\"none\" opacity=\"0.75\" marker-end=\"url(#m1)\"/><text x=\"307.5\" y=\"144.0\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"currentColor\" opacity=\"0.85\">implements the role</text><rect x=\"650\" y=\"190\" width=\"270\" height=\"96\" rx=\"9\" fill=\"#22a06b\" fill-opacity=\"0.1\" stroke=\"#22a06b\" stroke-width=\"1.5\" stroke-dasharray=\"6 4\"/><text x=\"785.0\" y=\"209\" text-anchor=\"middle\" font-size=\"12.5\" font-weight=\"700\" fill=\"currentColor\">BoundPadi — kolu&#x27;s SUB-ROLE</text><text x=\"785.0\" y=\"225\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">the same plug + 2 padi-shaped pins:</text><text x=\"785.0\" y=\"238\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">drainBoundPadi() — restart verb</text><text x=\"785.0\" y=\"251\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">padi identity readouts (hello)</text><path d=\"M 785 190 L 560 112\" stroke=\"currentColor\" stroke-width=\"1.4\" fill=\"none\" opacity=\"0.75\" marker-end=\"url(#m1)\" stroke-dasharray=\"6 4\"/><text x=\"672.5\" y=\"144.0\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"currentColor\" opacity=\"0.85\">extends the role (still an interface)</text><rect x=\"520\" y=\"340\" width=\"240\" height=\"96\" rx=\"9\" fill=\"#3b82f6\" fill-opacity=\"0.12\" stroke=\"#3b82f6\" stroke-width=\"1.5\"/><text x=\"640.0\" y=\"359\" text-anchor=\"middle\" font-size=\"12.5\" font-weight=\"700\" fill=\"currentColor\">PadiBindingSession (local arm)</text><text x=\"640.0\" y=\"375\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">unix socket to a padi on THIS box</text><text x=\"640.0\" y=\"388\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">its own reconnect loop (transport-</text><text x=\"640.0\" y=\"401\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">dictated — audited: L6 verdict c)</text><rect x=\"790\" y=\"340\" width=\"180\" height=\"96\" rx=\"9\" fill=\"#3b82f6\" fill-opacity=\"0.12\" stroke=\"#3b82f6\" stroke-width=\"1.5\"/><text x=\"880.0\" y=\"359\" text-anchor=\"middle\" font-size=\"12.5\" font-weight=\"700\" fill=\"currentColor\">RemotePadiSession</text><text x=\"880.0\" y=\"375\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">(remote arm)</text><text x=\"880.0\" y=\"388\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">WRAPS a HostSession</text><text x=\"880.0\" y=\"401\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">+ convergence policy</text><text x=\"880.0\" y=\"414\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">(the L3 kit&#x27;s decide())</text><path d=\"M 640 340 L 720 286\" stroke=\"currentColor\" stroke-width=\"1.4\" fill=\"none\" opacity=\"0.75\" marker-end=\"url(#m1)\"/><text x=\"680.0\" y=\"306.0\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"currentColor\" opacity=\"0.85\">implements BoundPadi</text><path d=\"M 880 340 L 850 286\" stroke=\"currentColor\" stroke-width=\"1.4\" fill=\"none\" opacity=\"0.75\" marker-end=\"url(#m1)\"/><text x=\"865.0\" y=\"306.0\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"currentColor\" opacity=\"0.85\">implements BoundPadi</text><path d=\"M 790 392 L 330 260\" stroke=\"#a855f7\" stroke-width=\"2\" fill=\"none\" opacity=\"0.75\" marker-end=\"url(#m1)\"/><text x=\"560.0\" y=\"319.0\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"#a855f7\" opacity=\"0.85\">wraps →</text><rect x=\"40\" y=\"340\" width=\"240\" height=\"80\" rx=\"9\" fill=\"#c08a2d\" fill-opacity=\"0.1\" stroke=\"#c08a2d\" stroke-width=\"1.5\"/><text x=\"160.0\" y=\"359\" text-anchor=\"middle\" font-size=\"12.5\" font-weight=\"700\" fill=\"currentColor\">reServeSurface (consumer)</text><text x=\"160.0\" y=\"375\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">mirror + serve-again machinery</text><text x=\"160.0\" y=\"388\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">accepts ANY plug — it consumes</text><text x=\"160.0\" y=\"401\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">the ROLE. Correct.</text><path d=\"M 160 340 L 400 112\" stroke=\"#22a06b\" stroke-width=\"1.4\" fill=\"none\" opacity=\"0.75\" marker-end=\"url(#m1)\"/><text x=\"280.0\" y=\"219.0\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"#22a06b\" opacity=\"0.85\">consumes the role ✓</text><rect x=\"40\" y=\"460\" width=\"340\" height=\"74\" rx=\"9\" fill=\"#c08a2d\" fill-opacity=\"0.1\" stroke=\"#c08a2d\" stroke-width=\"1.5\"/><text x=\"210.0\" y=\"479\" text-anchor=\"middle\" font-size=\"12.5\" font-weight=\"700\" fill=\"currentColor\">buildHostRegistry (consumer)</text><text x=\"210.0\" y=\"495\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">session-per-host map + ?host= dispatch</text><text x=\"210.0\" y=\"508\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">slot today: session: HostSession  ← names the APPLIANCE</text><text x=\"210.0\" y=\"521\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">the widen: session: PoolableSession (the role + destroy)</text><path d=\"M 230 460 L 195 296\" stroke=\"#d64545\" stroke-width=\"1.4\" fill=\"none\" opacity=\"0.75\" marker-end=\"url(#m1)\"/><text x=\"212.5\" y=\"371.0\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"#d64545\" opacity=\"0.85\">✗ today: names the class (the bug)</text><path d=\"M 330 460 L 470 114\" stroke=\"#22a06b\" stroke-width=\"1.4\" fill=\"none\" opacity=\"0.75\" marker-end=\"url(#m1)\" stroke-dasharray=\"5 4\"/><text x=\"400.0\" y=\"280.0\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"#22a06b\" opacity=\"0.85\">→ the widen: back to the role</text><g font-size=\"10\" fill=\"currentColor\" opacity=\"0.85\"><text x=\"420\" y=\"480\">dashed box = interface (a shape, nothing runs)</text><text x=\"420\" y=\"497\">solid box = running code</text><text x=\"420\" y=\"514\">arrows: implements / extends / wraps / consumes</text><text x=\"420\" y=\"531\">green ✓ = speaks the role · red ✗ = names the class (the smell)</text></g></svg>";
//#endregion
//#region src/diagrams/surface-hosting-101-after.svg?raw
var surface_hosting_101_after_default = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 980 640\" font-family=\"inherit\" role=\"img\" aria-label=\"Final shape: one reconnecting-session loop appliance with pluggable connectOnce transports and one admit hook; ssh session is just makeSession over the ssh connector — no named type; padi is one factory over two connectors; extension by object spread\"><defs><marker id=\"a5\" viewBox=\"0 0 8 8\" refX=\"7\" refY=\"4\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\"><path d=\"M 0 0 L 8 4 L 0 8 z\" fill=\"currentColor\" opacity=\"0.75\"/></marker></defs><rect x=\"28\" y=\"16\" width=\"924\" height=\"40\" rx=\"9\" fill=\"#22a06b\" fill-opacity=\"0.07\" stroke=\"#22a06b\" stroke-width=\"1.5\"/><text x=\"490.0\" y=\"35\" text-anchor=\"middle\" font-size=\"11\" font-weight=\"700\" fill=\"currentColor\">UNIVERSAL: every surface server auto-answers hello (framework-stamped) — identity is a property of serving</text><rect x=\"60\" y=\"80\" width=\"340\" height=\"74\" rx=\"9\" fill=\"#22a06b\" fill-opacity=\"0.1\" stroke=\"#22a06b\" stroke-width=\"1.5\" stroke-dasharray=\"6 4\"/><text x=\"230.0\" y=\"99\" text-anchor=\"middle\" font-size=\"12.5\" font-weight=\"700\" fill=\"currentColor\">Session&lt;Client&gt; — the ROLE</text><text x=\"230.0\" y=\"115\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">a self-healing source of clients:</text><text x=\"230.0\" y=\"128\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">currentClient across respawns · onState · identity()</text><rect x=\"430\" y=\"80\" width=\"300\" height=\"74\" rx=\"9\" fill=\"#22a06b\" fill-opacity=\"0.1\" stroke=\"#22a06b\" stroke-width=\"1.5\" stroke-dasharray=\"6 4\"/><text x=\"580.0\" y=\"99\" text-anchor=\"middle\" font-size=\"12.5\" font-weight=\"700\" fill=\"currentColor\">DaemonSession — sub-role</text><text x=\"580.0\" y=\"115\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">extends Session; supervision:</text><text x=\"580.0\" y=\"128\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">convergence() · renew() · preservation</text><path d=\"M 430 117 L 400 117\" stroke=\"currentColor\" stroke-width=\"1.4\" fill=\"none\" opacity=\"0.75\" marker-end=\"url(#a5)\"/><text x=\"415.0\" y=\"110.0\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"currentColor\" opacity=\"0.85\">extends</text><rect x=\"760\" y=\"80\" width=\"192\" height=\"74\" rx=\"9\" fill=\"#22a06b\" fill-opacity=\"0.1\" stroke=\"#22a06b\" stroke-width=\"1.5\" stroke-dasharray=\"6 4\"/><text x=\"856.0\" y=\"99\" text-anchor=\"middle\" font-size=\"12.5\" font-weight=\"700\" fill=\"currentColor\">ServerIdentity</text><text x=\"856.0\" y=\"115\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">contractVersion · startedAt</text><text x=\"856.0\" y=\"128\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">buildId ≠ commit (distinct)</text><rect x=\"280\" y=\"200\" width=\"420\" height=\"110\" rx=\"9\" fill=\"#a855f7\" fill-opacity=\"0.12\" stroke=\"#a855f7\" stroke-width=\"1.5\"/><text x=\"490.0\" y=\"219\" text-anchor=\"middle\" font-size=\"12.5\" font-weight=\"700\" fill=\"currentColor\">makeSession({ connectOnce, admit? })  — THE appliance</text><text x=\"490.0\" y=\"235\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">owns: reconnect · backoff · give-up-loudly · state merging</text><text x=\"490.0\" y=\"248\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">connectOnce = ONE attempt (transport plug) → { client, closed, isAlive }</text><text x=\"490.0\" y=\"261\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">admit = ONE typed hook gating each fresh spawn →</text><text x=\"490.0\" y=\"274\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">adopt | refuse(state) | replaced   (verdicts merge into onState)</text><path d=\"M 490 200 L 490 154\" stroke=\"currentColor\" stroke-width=\"1.4\" fill=\"none\" opacity=\"0.75\" marker-end=\"url(#a5)\"/><text x=\"490.0\" y=\"170.0\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"currentColor\" opacity=\"0.85\">returns the role</text><rect x=\"60\" y=\"360\" width=\"260\" height=\"80\" rx=\"9\" fill=\"#c08a2d\" fill-opacity=\"0.1\" stroke=\"#c08a2d\" stroke-width=\"1.5\"/><text x=\"190.0\" y=\"379\" text-anchor=\"middle\" font-size=\"12.5\" font-weight=\"700\" fill=\"currentColor\">endpointConnector(…)</text><text x=\"190.0\" y=\"395\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">local transport plug:</text><text x=\"190.0\" y=\"408\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">adopt-or-spawn via the supervisor</text><text x=\"190.0\" y=\"421\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">Endpoint · unix socket · socket-close</text><rect x=\"660\" y=\"360\" width=\"292\" height=\"80\" rx=\"9\" fill=\"#c08a2d\" fill-opacity=\"0.1\" stroke=\"#c08a2d\" stroke-width=\"1.5\"/><text x=\"806.0\" y=\"379\" text-anchor=\"middle\" font-size=\"12.5\" font-weight=\"700\" fill=\"currentColor\">sshConnector({ binary, drvMap… })</text><text x=\"806.0\" y=\"395\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">remote transport plug:</text><text x=\"806.0\" y=\"408\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">Nix provision · ssh front ·</text><text x=\"806.0\" y=\"421\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">hello-poll liveness</text><path d=\"M 190 360 L 380 310\" stroke=\"currentColor\" stroke-width=\"1.4\" fill=\"none\" opacity=\"0.75\" marker-end=\"url(#a5)\"/><text x=\"285.0\" y=\"328.0\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"currentColor\" opacity=\"0.85\">plugs into connectOnce</text><path d=\"M 800 360 L 620 310\" stroke=\"currentColor\" stroke-width=\"1.4\" fill=\"none\" opacity=\"0.75\" marker-end=\"url(#a5)\"/><text x=\"710.0\" y=\"328.0\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"currentColor\" opacity=\"0.85\">plugs into connectOnce</text><rect x=\"60\" y=\"470\" width=\"270\" height=\"76\" rx=\"9\" fill=\"#3b82f6\" fill-opacity=\"0.12\" stroke=\"#3b82f6\" stroke-width=\"1.5\"/><text x=\"195.0\" y=\"489\" text-anchor=\"middle\" font-size=\"12.5\" font-weight=\"700\" fill=\"currentColor\">drishti&#x27;s fleet nodes</text><text x=\"195.0\" y=\"505\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">a plain session over ssh:</text><text x=\"195.0\" y=\"518\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">makeSession({ connectOnce: sshConnector(…) })</text><text x=\"195.0\" y=\"531\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">no admit · no named constructor</text><path d=\"M 195 470 L 430 310\" stroke=\"currentColor\" stroke-width=\"1.4\" fill=\"none\" opacity=\"0.75\" marker-end=\"url(#a5)\" stroke-dasharray=\"4 3\"/><text x=\"312.5\" y=\"383.0\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"currentColor\" opacity=\"0.85\">is just</text><rect x=\"390\" y=\"470\" width=\"300\" height=\"90\" rx=\"9\" fill=\"#3b82f6\" fill-opacity=\"0.12\" stroke=\"#3b82f6\" stroke-width=\"1.5\"/><text x=\"540.0\" y=\"489\" text-anchor=\"middle\" font-size=\"12.5\" font-weight=\"700\" fill=\"currentColor\">padiSession(connector) — ONE factory</text><text x=\"540.0\" y=\"505\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">makeSession({ connectOnce: connector,</text><text x=\"540.0\" y=\"518\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">  admit: padiAdmit /* hello→decide→drain */ })</text><text x=\"540.0\" y=\"531\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">spread-extended: { ...base, convergence,</text><text x=\"540.0\" y=\"544\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">renew, preservation, … }  ← TS-idiomatic derive</text><path d=\"M 540 470 L 520 310\" stroke=\"currentColor\" stroke-width=\"1.4\" fill=\"none\" opacity=\"0.75\" marker-end=\"url(#a5)\" stroke-dasharray=\"4 3\"/><text x=\"530.0\" y=\"383.0\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"currentColor\" opacity=\"0.85\">built on</text><rect x=\"720\" y=\"470\" width=\"232\" height=\"90\" rx=\"9\" fill=\"#3b82f6\" fill-opacity=\"0.1\" stroke=\"#3b82f6\" stroke-width=\"1.5\" stroke-dasharray=\"4 3\"/><text x=\"836.0\" y=\"489\" text-anchor=\"middle\" font-size=\"12.5\" font-weight=\"700\" fill=\"currentColor\">the two former arms</text><text x=\"836.0\" y=\"505\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">local  = padiSession(endpointConnector)</text><text x=\"836.0\" y=\"518\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">remote = padiSession(sshConnector)</text><text x=\"836.0\" y=\"531\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">ONE construction, two plugs —</text><text x=\"836.0\" y=\"544\" text-anchor=\"middle\" font-size=\"10\" fill=\"currentColor\" opacity=\"0.82\">LocalPadiSession/RemotePadiSession collapse</text><path d=\"M 720 505 L 690 505\" stroke=\"currentColor\" stroke-width=\"1.4\" fill=\"none\" opacity=\"0.75\" marker-end=\"url(#a5)\"/><text x=\"705.0\" y=\"498.0\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"currentColor\" opacity=\"0.85\"></text><g font-size=\"10.5\" fill=\"currentColor\" opacity=\"0.9\"><text x=\"60\" y=\"606\" font-weight=\"700\">One loop, two plugs, one hook:</text><text x=\"270\" y=\"606\">the reconnect volatility lives once; transports are connectors; supervision is the admit hook; extension is object spread (closures, not classes).</text></g></svg>";
//#endregion
//#region src/content/atlas/surface-hosting-101.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		code: "code",
		em: "em",
		h2: "h2",
		h3: "h3",
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
		createVNode(_components.p, { children: createVNode(_components.em, { children: [
			"(This primer teaches the machinery behind ",
			createVNode(_components.a, {
				href: "padi.html",
				children: "the padi plan"
			}),
			"’s W4 switch; the post-switch feature menu is ",
			createVNode(_components.a, {
				href: "remote-terminals-future.html",
				children: "remote-terminals-future"
			}),
			".)"
		] }) }),
		"\n",
		"\n",
		createVNode(_components.p, { children: [
			"This note teaches one slice of the ",
			createVNode(_components.code, { children: "@kolu/surface" }),
			" stack — the slice that moves a surface ",
			createVNode(_components.strong, { children: "between machines" }),
			" — from the ground up, in plain words. It ends at a real, current decision (the W4 switch’s server pool) so the teaching has a point. You should be able to read this cold and then judge that decision yourself."
		] }),
		"\n",
		createVNode($$Svg, {
			svg: surface_hosting_101_map_default,
			wide: true,
			caption: "Two apps, one framework. Top: kolu's story — a browser bound to ONE host's padi through a mirror kolu-server holds. Bottom: drishti's story — a fleet of hosts behind a registry that picks by ?host=. Middle: the shared parts both are built from."
		}),
		"\n",
		createVNode(_components.h2, {
			id: "a-surface-is-a-menu-of-live-things",
			children: "A surface is a menu of live things"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"A ",
			createVNode(_components.strong, { children: "surface" }),
			" is a typed menu a server offers: ",
			createVNode(_components.em, { children: "these are the things you can watch and ask" }),
			". The menu has four kinds of item:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				"a ",
				createVNode(_components.strong, { children: "cell" }),
				" — one value that changes over time (the padi connection state, your preferences);"
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"a ",
				createVNode(_components.strong, { children: "collection" }),
				" — a keyed set of values (the ",
				createVNode(_components.code, { children: "terminals" }),
				" collection: one entry per terminal);"
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"a ",
				createVNode(_components.strong, { children: "procedure" }),
				" — ask once, get an answer (",
				createVNode(_components.code, { children: "git.getDiff" }),
				", ",
				createVNode(_components.code, { children: "preview.read" }),
				");"
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"a ",
				createVNode(_components.strong, { children: "stream" }),
				" — live bytes or events (",
				createVNode(_components.code, { children: "terminalAttach" }),
				": your terminal’s screen)."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"One side calls ",
			createVNode(_components.code, { children: "implementSurface" }),
			" and backs each item with real code. The other side gets a ",
			createVNode(_components.strong, { children: "client" }),
			" and subscribes — in the browser through Solid hooks (",
			createVNode(_components.code, { children: ".use()" }),
			"), so a cell changing repaints the UI by itself. The wire underneath (websocket, unix socket, ssh pipe) is interchangeable; the menu doesn’t care.",
			createVNode($$Footnote, { children: [
				"Kolu’s browser actually talks to three sibling surfaces over one websocket — ",
				createVNode(_components.code, { children: "app" }),
				" (the web shell), ",
				createVNode(_components.code, { children: "padi" }),
				" (everything terminal), ",
				createVNode(_components.code, { children: "surfaceApp" }),
				" (build identity). One socket, three menus."
			] })
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "a-mirror-is-how-a-surface-crosses-a-machine",
			children: "A mirror is how a surface crosses a machine"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Now the interesting part. padi serves its surface on a ",
			createVNode(_components.strong, { children: "unix socket on its own machine" }),
			". Your browser can’t reach that. So kolu-server sits in the middle and does two things at once:"
		] }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "subscribe to everything" }),
				" padi serves, and keep a live local copy (the ",
				createVNode(_components.em, { children: "mirror" }),
				");"
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "serve that copy onward" }), " to browsers, forwarding writes back up."] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"That combination is ",
			createVNode(_components.code, { children: "reServeSurface" }),
			" — ",
			createVNode(_components.em, { children: "mirror it, then serve it again" }),
			". It’s how the same canvas works whether padi is local or on another machine: the browser always talks to kolu-server’s copy; only the pipe ",
			createVNode(_components.strong, { children: "behind" }),
			" the copy changes."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"One rule makes this safe, and it’s per-item: ",
			createVNode(_components.strong, { children: "values may be held and replayed; live byte streams must break loudly." }),
			" If the pipe to padi blips, the mirror keeps showing the last known terminal ",
			createVNode(_components.em, { children: "list" }),
			" (a value — replaying it is honest) but your terminal’s ",
			createVNode(_components.em, { children: "screen" }),
			" stream must end and reattach fresh (replaying stale bytes would silently lie).",
			createVNode($$Footnote, { children: [
				"This per-item rule is declared in the contract itself and pinned by a test — every member says which kind it is. The gray-chip bug (#1681) lived one layer below this: asking the mirror for a key that didn’t exist ",
				createVNode(_components.em, { children: "yet" }),
				" used to kill the subscription; since #1687 it politely waits."
			] })
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "a-session-is-the-thing-that-owns-the-pipe",
			children: "A session is the thing that owns the pipe"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"First, one word this note leans on: ",
			createVNode(_components.strong, { children: "bound" }),
			". Kolu-server can talk to a daemon two ways — a ",
			createVNode(_components.strong, { children: "dial" }),
			" (connect, do one thing, leave — ",
			createVNode(_components.code, { children: "padi-tui status" }),
			", ",
			createVNode(_components.code, { children: "kaval-tui" }),
			") or a ",
			createVNode(_components.strong, { children: "bound session" }),
			": a durable, supervised relationship it ",
			createVNode(_components.em, { children: "keeps" }),
			" — holds open across reconnects, watches health, converges on version mismatch, re-serves to browsers, outlives any single browser tab. A ",
			createVNode(_components.strong, { children: "bound daemon" }),
			" is one kolu-server holds a bound session to. Today that is ",
			createVNode(_components.strong, { children: "only padi" }),
			"; kaval is bound one layer down, by padi, through different (in-process) machinery — which is why “a second bound daemon” below does not mean kaval."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Something has to own the messy lifecycle of that behind-the-copy pipe: dial it, notice it died, redial, give up loudly after too many failures. That something is a ",
			createVNode(_components.strong, { children: "session" }),
			", and there are two words to keep apart:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					createVNode(_components.code, { children: "RemoteMirrorSession" }),
					" is a ",
					createVNode(_components.em, { children: "role" })
				] }),
				" — a small interface saying only: ",
				createVNode(_components.em, { children: "“I can hand you a live client, and tell you the connection’s state.”" }),
				" Anything satisfying it can sit behind ",
				createVNode(_components.code, { children: "reServeSurface" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: [
				createVNode(_components.code, { children: "HostSession" }),
				" is one ",
				createVNode(_components.em, { children: "class" }),
				" that plays the role over ssh"
			] }), " — it also Nix-provisions the binary onto the host, runs it through an ssh pipe, reconnects with backoff, and gives up loudly. Drishti uses it directly for every machine in its fleet."] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Kolu defines its own flavor of the role, ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "BoundPadi" }) }),
			": a ",
			createVNode(_components.code, { children: "RemoteMirrorSession" }),
			" ",
			createVNode(_components.em, { children: "plus" }),
			" the padi-specific verbs kolu needs (drain the daemon for restart; report its identity). It has two implementations — the ",
			createVNode(_components.strong, { children: "local arm" }),
			" (plain unix socket to a padi on this machine) and the ",
			createVNode(_components.strong, { children: "remote arm" }),
			" (which ",
			createVNode(_components.em, { children: "wraps" }),
			" a ",
			createVNode(_components.code, { children: "HostSession" }),
			", adding padi’s convergence policy on top). Same role, two transports; ",
			createVNode(_components.code, { children: "reServeSurface" }),
			" can’t tell them apart. That indifference is the whole design."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Three session-ish names is a smell — so let’s be exact about why the code is (mostly) innocent." }),
			" These are not three ways of doing one thing; they are one ",
			createVNode(_components.em, { children: "plug shape" }),
			", one ",
			createVNode(_components.em, { children: "appliance" }),
			", and one ",
			createVNode(_components.em, { children: "plug-with-extra-pins" }),
			":"
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "name" }),
					"\n",
					createVNode(_components.th, { children: "what it is" }),
					"\n",
					createVNode(_components.th, { children: "runs anything?" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "RemoteMirrorSession" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"the ",
						createVNode(_components.strong, { children: "role" }),
						" — the plug shape every session must fit"
					] }),
					"\n",
					createVNode(_components.td, { children: "no — pure interface" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "HostSession" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"the ",
						createVNode(_components.strong, { children: "one appliance" }),
						" for “pipe to another machine” (ssh + Nix + reconnect)"
					] }),
					"\n",
					createVNode(_components.td, { children: "yes" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "BoundPadi" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"the role ",
						createVNode(_components.strong, { children: "plus the two padi-only verbs" }),
						": ",
						createVNode(_components.em, { children: "drain" }),
						" (“save state and exit gracefully” — the Restart button; kaval + PTYs survive) and ",
						createVNode(_components.em, { children: "identity" }),
						" (who is on the other end: started-when · contract version · build commit, off the ",
						createVNode(_components.code, { children: "hello" }),
						" handshake) — a domain extension, not a re-implementation"
					] }),
					"\n",
					createVNode(_components.td, { children: "no — interface; its two arms run" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"A fair follow-up (srid asked it): ",
			createVNode(_components.em, { children: [
				"why shouldn’t the generic ",
				createVNode(_components.code, { children: "HostSession" }),
				" optionally offer drain and identity?"
			] }),
			" Because they aren’t plumbing — they’re ",
			createVNode(_components.strong, { children: "conversation" }),
			": ",
			createVNode(_components.code, { children: "drain" }),
			" and ",
			createVNode(_components.code, { children: "hello" }),
			" are procedures the ",
			createVNode(_components.em, { children: "far end" }),
			" serves; the transport only carries them. Three precise points that came out of pushing on this:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Identity SHOULD already be universal — there is no “if.”" }),
				" Every durable daemon stamps its identity (started-at · commit · contract version) and answers ",
				createVNode(_components.code, { children: "hello" }),
				", and the L3 kit already extracted that as a generic type (",
				createVNode(_components.code, { children: "ConvergenceIdentity" }),
				") used for both padi and kaval. So identity is ",
				createVNode(_components.em, { children: "already" }),
				" universal in substance; the only unfinished bit is putting an ",
				createVNode(_components.code, { children: "identity()" }),
				" accessor on a shared daemon-session role. That is plumbing left undone, not a design bet — the frozen control core was always planned to graduate into the shared daemon package as the standard preamble. State it flatly: ",
				createVNode(_components.strong, { children: [
					"daemon identity is universal; graduating ",
					createVNode(_components.code, { children: "hello" }),
					" finishes a job, it doesn’t take a risk."
				] })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Drain vs recycle are NOT one verb with a flag — and the difference is the one thing a user cares about." }),
				" A ",
				createVNode(_components.code, { children: "kill(respawn: true)" }),
				" flag would hide ",
				createVNode(_components.em, { children: "“do my running programs survive?”" }),
				", which is catastrophic to bury in a boolean. The split traces to ONE root — ",
				createVNode(_components.strong, { children: "where the daemon’s valuable state lives" }),
				": padi’s PTYs live in ",
				createVNode(_components.em, { children: "kaval" }),
				" (a separate process), so padi can ",
				createVNode(_components.em, { children: "drain" }),
				" — persist, exit gracefully (never a kill-9; #1313), programs SURVIVE, a fresh padi adopts them, automatic. kaval’s PTYs are its OWN children, so it cannot drain: its supervisor (padi) must orchestrate capture→kill→respawn→restore from outside — scrollback returns, ",
				createVNode(_components.strong, { children: "running programs die" }),
				" — which is why it’s human-gated. Different level, too: ",
				createVNode(_components.code, { children: "drain" }),
				" is self-served on padi’s control core; ",
				createVNode(_components.code, { children: "recycle" }),
				" is done TO kaval from outside. The L3 kit types the capability so the false promise can’t compile (",
				createVNode(_components.code, { children: "DrainableProbe" }),
				" vs ",
				createVNode(_components.code, { children: "PlainProbe" }),
				")."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The real unification is at INTENT, not the verb (open question)." }),
				" Both verbs serve one intent — ",
				createVNode(_components.em, { children: "“the running daemon isn’t the build I want; make it so, preserving what user-state can be preserved”" }),
				" — which the kit already unifies (",
				createVNode(_components.code, { children: "decide()" }),
				"/",
				createVNode(_components.code, { children: "converge()" }),
				"). What differs is enactment, and it differs by a fact each daemon could ",
				createVNode(_components.em, { children: "declare" }),
				": “my state is external → drain me” vs “my state is internal → snapshot-kill-restore me.” Whether a supervisor ",
				createVNode(_components.code, { children: "renew()" }),
				" should branch on a declared preservation strategy is a genuine open design question — see Proposed solution."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "“Second bound daemon” precisely:" }),
				" drishti’s far end today is an ",
				createVNode(_components.em, { children: "ephemeral" }),
				" agent (lives and dies with the link — no gate, no state-root, nothing to drain), so it is not a bound daemon. padi is the only daemon kolu-server binds. So the trigger for packaging a shared ",
				createVNode(_components.code, { children: "SupervisedSession" }),
				" is “a second daemon kolu-server BINDS” — not yet real. The identity half, per the first point, needn’t wait for it at all."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The one place mechanism-duplication was genuinely suspected — the local arm’s reconnect loop vs ",
			createVNode(_components.code, { children: "HostSession" }),
			"’s — was formally audited (ledger L6, verdict c): different transports honestly dictate different reconnect mechanisms, while the ",
			createVNode(_components.em, { children: "policy" }),
			" both arms follow is shared through the L3 convergence kit. Acquitted, with the reasoning on record."
		] }),
		"\n",
		createVNode($$Svg, {
			svg: surface_hosting_101_roles_default,
			wide: true,
			caption: "TODAY's shapes (what the code on master looks like as you read this). The red arrow is the smell that started everything: the registry's slot names the class. The AFTER picture — post-ledger — is at the end of the note, next to the final API."
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Where a real smell ",
			createVNode(_components.em, { children: "does" }),
			" live, your nose is right — twice, in fact — and that’s the last section’s subject."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-registry-is-many-sessions-picked-by-name",
			children: "The registry is “many sessions, picked by name”"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Drishti’s product is a ",
			createVNode(_components.em, { children: "fleet" }),
			": N machines at once. So the framework grew ",
			createVNode(_components.code, { children: "buildHostRegistry" }),
			": a map from host name to ",
			createVNode(_components.code, { children: "{ session, handler }" }),
			", plus a dispatcher — when a websocket arrives with ",
			createVNode(_components.code, { children: "?host=zest" }),
			", hand it zest’s entry. It also has fleet-keeping verbs: add a host, remove one, ",
			createVNode(_components.code, { children: "reconnect(host)" }),
			", ",
			createVNode(_components.code, { children: "recheckAll()" }),
			"."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Notice what this ",
			createVNode(_components.em, { children: "is" }),
			": ",
			createVNode(_components.strong, { children: "“hold a session per host and dispatch by name” — extracted once, as a shared part" }),
			", because drishti proved the need. In this codebase’s vocabulary that makes it ",
			createVNode(_components.em, { children: "electricity" }),
			": a receptacle in the framework wall, not app code."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-fork-we-just-hit--and-how-to-judge-it",
			children: "The fork we just hit — and how to judge it"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The W4 switch needs kolu-server to hold ",
			createVNode(_components.strong, { children: "several bound padis at once" }),
			" and pick one per browser tab. Read the last two sections again: that is ",
			createVNode(_components.em, { children: "literally" }),
			" what ",
			createVNode(_components.code, { children: "buildHostRegistry" }),
			" does. So the plan said “consume it.”"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The agent then hit a wall, and the wall is worth understanding precisely. The registry’s slot is typed with the ",
			createVNode(_components.strong, { children: "class" }),
			":"
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
						children: "// today — the slot names a concrete class:"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "interface"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " HostEntry"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "C"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "> { "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "session"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " HostSession"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "C"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ">; "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "handler"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " WsRpcHandler"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " }"
						})
					]
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "HostSession" }),
			" has private fields, and in TypeScript a class with private fields can only be satisfied by ",
			createVNode(_components.em, { children: "itself" }),
			".",
			createVNode($$Footnote, { children: [
				"Normally TypeScript is structural — anything with the right shape fits. Private fields switch a class to effectively ",
				createVNode(_components.em, { children: "nominal" }),
				": only real instances qualify. That’s why ",
				createVNode(_components.code, { children: "BoundPadi" }),
				", despite having everything the registry actually uses, cannot compile into that slot."
			] }),
			" Kolu’s ",
			createVNode(_components.code, { children: "BoundPadi" }),
			" is a role, not that class — so it doesn’t fit, and the tempting exit is: ",
			createVNode(_components.em, { children: "“fine, I’ll hand-roll my own little map in kolu-server.”" })
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Here is the discipline for judging that exit, and it’s one question: ",
			createVNode(_components.strong, { children: [
				"is the mismatch about ",
				createVNode(_components.em, { children: "behavior" }),
				" or about a ",
				createVNode(_components.em, { children: "type annotation" }),
				"?"
			] }),
			" Check what the registry’s code actually ",
			createVNode(_components.em, { children: "calls" }),
			" on the slot. Answer (verified): the core calls only ",
			createVNode(_components.code, { children: ".destroy()" }),
			"; ",
			createVNode(_components.code, { children: "reconnect" }),
			"/",
			createVNode(_components.code, { children: "recheck" }),
			" are used by exactly two fleet-keeping methods kolu never invokes. The behavior fits perfectly — only the annotation doesn’t. That’s a ",
			createVNode(_components.strong, { children: "type problem" }),
			", and the fix for a type problem is to fix the type:"
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
						children: "// the widen — name the role the registry actually needs:"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "interface"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " PoolableSession"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "C"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "> "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "extends"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " RemoteMirrorSession"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "C"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "> {"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  destroy"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "()"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " void"
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
							children: "  reconnect"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "?"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "()"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " void"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";   "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// fleet-keeping; only reconnect(host) touches it"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  recheck"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "?"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "()"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " void"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";     "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// fleet-keeping; only recheckAll() touches it"
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
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "interface"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " HostEntry"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "C"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "> { "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "session"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " PoolableSession"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "C"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ">; "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "handler"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " WsRpcHandler"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " }"
						})
					]
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "HostSession" }),
			" already has all four members, so drishti compiles unchanged — its green CI is the proof the widening broke nobody. ",
			createVNode(_components.code, { children: "BoundPadi" }),
			" has the two required ones, so kolu now fits. One receptacle, two consumers."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"And the road not taken, named honestly: a bespoke ",
			createVNode(_components.code, { children: "Map<host, …>" }),
			" in kolu-server would have been a ",
			createVNode(_components.strong, { children: "second implementation of one volatility" }),
			" — exactly the duplication the L3 convergence-kit work just spent two PRs deleting elsewhere. The type wall made the clone ",
			createVNode(_components.em, { children: "tempting" }),
			"; it never made it ",
			createVNode(_components.em, { children: "right" }),
			".",
			createVNode($$Footnote, { children: [
				"One refinement still open to the review lenses: optional methods that silently don’t exist are a mild fallback smell. The stricter shape makes “reconnectable” a declared capability, so calling ",
				createVNode(_components.code, { children: "reconnect" }),
				" on a pool of non-reconnectable sessions is a compile error rather than a no-op. Whether that rigor is worth its complexity is a per-review judgment."
			] })
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The takeaway rule, beyond this case:" }),
			" when your thing won’t fit a framework slot, first ask what the slot’s code actually ",
			createVNode(_components.em, { children: "does" }),
			" with it. If the behavior fits and only the annotation refuses — widen the slot to the role. If the behavior genuinely differs — that’s when you’re allowed to build your own."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-final-api--what-youll-write-as-a-framework-user",
			children: "The final API — what you’ll write as a framework user"
		}),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.em, { children: [
			"(Build-time refinements the implementing agent surfaced — four roadblocks resolved in code — live in ",
			createVNode(_components.a, {
				href: "surface-hosting-roadblocks.html",
				children: "surface-hosting-roadblocks"
			}),
			"; they refine a few specifics below — notably the reserved ",
			createVNode(_components.code, { children: "system.identity" }),
			" member is BUNDLED into this PR, so ",
			createVNode(_components.code, { children: "identity()" }),
			" is on the base ",
			createVNode(_components.code, { children: "Session" }),
			" role (named ",
			createVNode(_components.code, { children: "SurfaceIdentity" }),
			"), and ",
			createVNode(_components.code, { children: "DaemonSession" }),
			" adds only supervision.)"
		] }) }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Three consumers move together on this" }),
			" — kolu, ",
			createVNode(_components.a, {
				href: "https://github.com/srid/drishti",
				children: "drishti"
			}),
			", and ",
			createVNode(_components.a, {
				href: "https://github.com/juspay/odu",
				children: "odu"
			}),
			" — so it lands as THREE paired PRs, all green before any merges (the paired-PR gate, extended to three). ",
			createVNode(_components.em, { children: [
				"(The shapes below are the ratified end-state — the three-AI debate record that produced them lives in this branch’s git history, ",
				createVNode(_components.code, { children: "debates/surface-hosting-simplify/" }),
				" at commit ",
				createVNode(_components.code, { children: "0fad064e8^" }),
				"; none of it is needed to use this.)"
			] })
		] }),
		"\n",
		createVNode($$Svg, {
			svg: surface_hosting_101_after_default,
			wide: true,
			caption: "After the series lands — with the implementations shown. MirrorSession has THREE implementations (HostSession + the two padi arms); DaemonSession has exactly TWO (the padi arms — the only sessions that supervise); BoundPadi is the alias naming their shared type; the remote arm composes a HostSession rather than reimplementing it. No red arrows left."
		}),
		"\n",
		createVNode(_components.h3, {
			id: "the-types-youll-touch",
			children: "The types you’ll touch"
		}),
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
						children: "// ── @kolu/surface-daemon — identity is ONE value, served by EVERY server ──"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "interface"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " ServerIdentity"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " {"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "  contractVersion"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " string"
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
							style: { color: "#E36209" },
							children: "  startedAt"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " number"
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
							style: { color: "#E36209" },
							children: "  buildId"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " string"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";        "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// convergence currency (the staleKey) — deliberately"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "  commit"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " string"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " |"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " null"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";  "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// distinct from the navigable commit; never merged"
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
				}),
				"\n",
				createVNode(_components.span, { class: "line" }),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// ── @kolu/surface-nix-host ──"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "interface"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " MirrorSession"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "Client"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " SurfaceClientLike"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "> {"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  pin"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "()"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " Promise"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "Client"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ">;"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  currentClient"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "()"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " Promise"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "Client"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "> "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "|"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " null"
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
							children: "  isDestroyed"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "()"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " boolean"
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
							children: "  onState"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "("
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "cb"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " ("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "s"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " SessionState"
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
							style: { color: "#005CC5" },
							children: " void"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ")"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " () "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "=>"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " void"
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
							children: "  markConnected"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "()"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " void"
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
							children: "  destroy"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "()"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " void"
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
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "  /** Universal — every server answers hello (the framework stamps it), so this"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "   *  is null only transiently before first contact, never null-forever. */"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  identity"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "()"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " ServerIdentity"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " |"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " null"
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
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "}"
					})
				}),
				"\n",
				createVNode(_components.span, { class: "line" }),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "/** The daemon flavor adds supervision — and supervision INCLUDES replacement:"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: " *  renew() is the manual trigger of the same machinery convergence() reports on,"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: " *  and preservation declares what replacement costs (the fact a user cares about). */"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "interface"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " DaemonSession"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "Client"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " SurfaceClientLike"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "> "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "extends"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " MirrorSession"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "Client"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "> {"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  convergence"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "()"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " DaemonConvergence"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " |"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " null"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";  "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// adopted-stale · skew-refused · unconverged · link-failed"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "  readonly"
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: " preservation"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " PreservationStrategy"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// padi: children \"survive\" · (kaval's vocab: \"die\")"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  renew"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "()"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " Promise"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: "void"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ">;                   "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// replace the daemon per its declared strategy"
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
				}),
				"\n",
				createVNode(_components.span, { class: "line" }),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "/** The registry demands exactly what it calls — one method. */"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "interface"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " DestroyableSession"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " { "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "destroy"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "()"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " void"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " }"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "interface"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " HostEntry"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "S"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " extends"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " DestroyableSession"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "H"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "> { "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "session"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " S"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "handler"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " H"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " }"
						})
					]
				}),
				"\n",
				createVNode(_components.span, { class: "line" }),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "function"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " buildHostRegistry"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "S"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " extends"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " DestroyableSession"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "H"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ">("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "opts"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " {"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "  initialHosts"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " readonly"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " string"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "[];"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  buildEntry"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "host"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " string"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ")"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " HostEntry"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "S"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "H"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ">;"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  persist"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "?:"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " ("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "hosts"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " string"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "[]) "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "=>"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " Promise"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: "void"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ">;"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "  /** Supply this and the RETURNED TYPE gains reconnect(host)/recheckAll()."
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "   *  Omit it and those members don't exist — calling them won't compile. */"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "  controls"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "?:"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " { "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "reconnect"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "s"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " S"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ")"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " void"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "recheck"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "s"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " S"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ")"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " void"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " };"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "})"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " HostRegistry"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "S"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "H"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ">;"
						})
					]
				})
			] })
		}),
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
						children: "// ── kolu's whole padi-session vocabulary, after: THERE ISN'T ONE ──"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// BoundPadi is deleted (srid: the alias was redundant — once renew/preservation"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// fold into the `DaemonSession` sub-role, nothing padi-specific remains to name)."
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// Call sites write the instantiation directly:"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "DaemonSession"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "PadiSurfaceClient"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ">"
						})
					]
				})
			] })
		}),
		"\n",
		createVNode(_components.h3, {
			id: "kolus-usage-sites",
			children: "kolu’s usage sites"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The server pool (W4-PR1) — note there are ",
			createVNode(_components.strong, { children: "no fleet controls" }),
			", so ",
			createVNode(_components.code, { children: "pool.reconnect" }),
			" doesn’t exist and can’t be called by accident:"
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
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "const"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " pool"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " buildHostRegistry"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "DaemonSession"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "PadiSurfaceClient"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ">, "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "WsRpcHandler"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ">({"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "  initialHosts: ["
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: "LOCAL_HOST"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "],"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  buildEntry"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": ("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "host"
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
							children: " {"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "    const"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " session"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " DaemonSession"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "PadiSurfaceClient"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "> "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "="
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "      host "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "==="
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " LOCAL_HOST"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ?"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " ensurePadiBinding"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "({ … }) "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " bindRemotePadi"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "({ host });"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "    const"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " reServed"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " reServeSurface"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "({ source: padiSurface, policy, session });"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#D73A49" },
						children: "    return"
					}), createVNode(_components.span, {
						style: { color: "#24292E" },
						children: " { session, handler: reServed.wsHandler };"
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "  },"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  persist"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": ("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "hosts"
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
							children: " prefs."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "patch"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "({ recentHosts: hosts }),"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "});"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// websocket upgrade: pool.getHandler(hostOf(req)) — each tab names its host"
					})
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: "The dialogs and the restart button — six bespoke readouts become two accessors and one verb:" }),
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
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "const"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " id"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " session."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "identity"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "();          "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// { startedAt, commit, contractVersion, buildId } | null"
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
							children: " conv"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " session."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "convergence"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "();     "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// the standing banner state, or null when healthy"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "await"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " session."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "renew"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "();                  "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// the Restart verb; session.preservation.children === \"survive\""
						})
					]
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: "The browser (W4-PR2’s entire framework delta):" }),
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
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "SurfaceAppProvider controlPlane"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "{() => "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "active"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "().clients.surfaceApp} …"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ">"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "//                  today's static callers just write: {() => surfaceApp}"
					})
				})
			] })
		}),
		"\n",
		createVNode(_components.h3, {
			id: "drishtis-usage-sites",
			children: "drishti’s usage sites"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The fleet — ",
			createVNode(_components.strong, { children: "with" }),
			" controls, so the fleet verbs exist, typed:"
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
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "const"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " fleet"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " buildHostRegistry"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "HostSession"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "AgentContract"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ">, "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "WsRpcHandler"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ">({"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "  initialHosts: cfg.hosts,"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  buildEntry"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": ("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "host"
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
							children: " {"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "    const"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " session"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " makeSession"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "({ connectOnce: "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "sshConnector"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "AgentContract"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ">({ host, binary: "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\"drishti-agent\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", localEnv }) });"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "    return"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " { session, handler: "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "agentHandler"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(session) };"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "  },"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "  controls: { "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "reconnect"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": ("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "s"
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
							children: " s."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "reconnect"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(), "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "recheck"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": ("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "s"
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
							children: " s."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "recheck"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "() },"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "});"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "fleet."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "reconnect"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "("
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\"zest\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ");   "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// exists BECAUSE controls were declared"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "fleet."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "recheckAll"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "();"
						})
					]
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: "The fleet rows — identity for free on every agent (they auto-serve hello now; drishti writes nothing):" }),
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
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "const"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " id"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " fleet."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "getSession"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(host)?."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "identity"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "();"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "row.uptime "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " id "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "&&"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " Date."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "now"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "() "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "-"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " id.startedAt;"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "row.build  "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " id?.commit "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "??"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " id?.buildId."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "slice"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "("
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: "0"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", "
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: "8"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ");"
						})
					]
				})
			] })
		}),
		"\n",
		createVNode(_components.h3, {
			id: "the-two-arms-precisely-they-differ-only-below-the-waterline",
			children: "The two arms, precisely (they differ ONLY below the waterline)"
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, {}),
					"\n",
					createVNode(_components.th, { children: [
						createVNode(_components.code, { children: "LocalPadiSession" }),
						" ",
						createVNode(_components.em, { children: [
							"(today: ",
							createVNode(_components.code, { children: "PadiBindingSession" }),
							" — renamed for symmetry; the name should say the one thing that differs)"
						] })
					] }),
					"\n",
					createVNode(_components.th, { children: createVNode(_components.code, { children: "RemotePadiSession" }) }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "gets the pipe" }),
					"\n",
					createVNode(_components.td, { children: "unix socket to a padi it adopt-or-spawns via the local endpoint" }),
					"\n",
					createVNode(_components.td, { children: [
						"wraps a ",
						createVNode(_components.code, { children: "HostSession" }),
						" (Nix-provisions padi, fronts it over ssh)"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "keeps the pipe" }),
					"\n",
					createVNode(_components.td, { children: "its own reconnect loop (bridges the one-shot endpoint onto the mirror contract — the L6-audited, transport-dictated exception)" }),
					"\n",
					createVNode(_components.td, { children: [
						"delegates to ",
						createVNode(_components.code, { children: "HostSession" }),
						"’s ssh reconnect"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "knows a drain “took”" }),
					"\n",
					createVNode(_components.td, { children: "waits on the unix socket CLOSE (authoritative kernel signal)" }),
					"\n",
					createVNode(_components.td, { children: [
						"polls ",
						createVNode(_components.code, { children: "hello" }),
						" under the instance-keyed fence (ssh has no close signal)"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "extras" }),
					"\n",
					createVNode(_components.td, { children: "the legacy-kaval adoption hint · spawn-flag forwarding" }),
					"\n",
					createVNode(_components.td, { children: "the drv map · the ssh-user caveat" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Everything above that line is shared and identical: one convergence policy (both feed the kit’s ",
			createVNode(_components.code, { children: "decide()" }),
			"), one verb set, one identity readout, the same surfaced degraded states. Two transports, one behavior — both simply ",
			createVNode(_components.code, { children: "DaemonSession<PadiSurfaceClient>" }),
			"; no alias needed (deleted per srid)."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "what-a-user-never-sees-anymore",
			children: "What a user never sees anymore"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "RemoteMirrorSession" }),
			" (→ ",
			createVNode(_components.code, { children: "Session" }),
			" — reconnecting is universal, so the qualifier was noise; opposed to a ",
			createVNode(_components.em, { children: "dial" }),
			") · ",
			createVNode(_components.code, { children: "DaemonMirrorSession" }),
			" (→ ",
			createVNode(_components.code, { children: "DaemonSession" }),
			" — “Mirror” named the consumer) · ",
			createVNode(_components.code, { children: "HostSession" }),
			" ",
			createVNode(_components.strong, { children: "and" }),
			" ",
			createVNode(_components.code, { children: "SshHostSession" }),
			" (both DELETED — post-S9 “a session over ssh” is no type or class, just ",
			createVNode(_components.code, { children: "makeSession({ connectOnce: sshConnector(…) })" }),
			"; the connector is the primitive, the composition inlined — the ",
			createVNode(_components.code, { children: "BoundPadi" }),
			" rule again) · ",
			createVNode(_components.code, { children: "BoundPadi" }),
			" (deleted — after renew/preservation joined ",
			createVNode(_components.code, { children: "DaemonSession" }),
			", nothing padi-specific remained to name) · ",
			createVNode(_components.code, { children: "PadiBindingSession" }),
			"/",
			createVNode(_components.code, { children: "RemotePadiSession" }),
			" as classes (gone — one ",
			createVNode(_components.code, { children: "makeSession" }),
			" loop + ",
			createVNode(_components.code, { children: "endpointConnector" }),
			"/",
			createVNode(_components.code, { children: "sshConnector" }),
			" plugs + one ",
			createVNode(_components.code, { children: "admit" }),
			" hook; the two arms are two calls to ",
			createVNode(_components.code, { children: "padiSession(connector)" }),
			", daemon members added by object spread — no wrapper classes, no forwarding boilerplate) · the role’s dead ",
			createVNode(_components.code, { children: "<C>" }),
			" generic · ",
			createVNode(_components.code, { children: "PoolableSession" }),
			" (never shipped) · the six bespoke identity readouts (→ one ",
			createVNode(_components.code, { children: "identity()" }),
			") · ",
			createVNode(_components.code, { children: "drainBoundPadi" }),
			" (→ ",
			createVNode(_components.code, { children: "renew()" }),
			", survival in the type) · ",
			createVNode(_components.code, { children: "evictHostSession" }),
			" (zero production callers; deleted). ",
			createVNode(_components.strong, { children: [createVNode(_components.code, { children: "getHostSession" }), " and its module-global session pool are DELETED (S10)."] }),
			" The pool duplicated what every consumer already keeps in its own structure (kolu’s registry, odu’s lane set, drishti’s fleet), collided with ",
			createVNode(_components.code, { children: "buildHostRegistry" }),
			"’s own map (the source of the “destroyed-instance” dance), and was a shared mutable place with no single owner. Consumers now compose directly — ",
			createVNode(_components.code, { children: "makeSession({ connectOnce: sshConnector(opts) })" }),
			" — and own the session they get, tearing down their own on shutdown. So ",
			createVNode(_components.code, { children: "evictHostSession" }),
			" and ",
			createVNode(_components.code, { children: "destroyAllSessions" }),
			" go too (odu loops its own lane sessions). ",
			createVNode(_components.code, { children: "HostSessionState" }),
			"→",
			createVNode(_components.code, { children: "SessionState" }),
			" still moves in odu’s PR."
		] })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "The surface framework's hosting side, taught",
	"description": "A plain-words primer on how a surface travels between machines — serve, mirror, re-serve, sessions, and the host registry — ending at the exact type-vs-volatility fork the W4 switch ran into.",
	"parents": [
		"pedagogy",
		"padi",
		"surface"
	],
	"maturity": "seedling",
	"updated": "2026-07-05T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "a-surface-is-a-menu-of-live-things",
			"text": "A surface is a menu of live things"
		},
		{
			"depth": 2,
			"slug": "a-mirror-is-how-a-surface-crosses-a-machine",
			"text": "A mirror is how a surface crosses a machine"
		},
		{
			"depth": 2,
			"slug": "a-session-is-the-thing-that-owns-the-pipe",
			"text": "A session is the thing that owns the pipe"
		},
		{
			"depth": 2,
			"slug": "the-registry-is-many-sessions-picked-by-name",
			"text": "The registry is “many sessions, picked by name”"
		},
		{
			"depth": 2,
			"slug": "the-fork-we-just-hit--and-how-to-judge-it",
			"text": "The fork we just hit — and how to judge it"
		},
		{
			"depth": 2,
			"slug": "the-final-api--what-youll-write-as-a-framework-user",
			"text": "The final API — what you’ll write as a framework user"
		},
		{
			"depth": 3,
			"slug": "the-types-youll-touch",
			"text": "The types you’ll touch"
		},
		{
			"depth": 3,
			"slug": "kolus-usage-sites",
			"text": "kolu’s usage sites"
		},
		{
			"depth": 3,
			"slug": "drishtis-usage-sites",
			"text": "drishti’s usage sites"
		},
		{
			"depth": 3,
			"slug": "the-two-arms-precisely-they-differ-only-below-the-waterline",
			"text": "The two arms, precisely (they differ ONLY below the waterline)"
		},
		{
			"depth": 3,
			"slug": "what-a-user-never-sees-anymore",
			"text": "What a user never sees anymore"
		}
	];
}
var url = "src/content/atlas/surface-hosting-101.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-hosting-101.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-hosting-101.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
