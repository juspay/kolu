#!/usr/bin/env python3
"""Publish content-addressed closures and the index that names them.

Lifted from agent-distro's `.github/scripts/ca-index.py` (agent-distro#99,
#102) and generalised for any `@kolu/surface` binder. A host whose Nix will not
honour the publisher's cache cannot take an input-addressed path from it: an
untrusted user's substituters, keys and `--no-check-sigs` are all dropped
(nix.conf `require-sigs`). A content-addressed path is trusted by itself, so
`nix copy --from <cache>` accepts it from anyone. This script does the rewrite
CI cannot leave to the host, and writes the entries `@kolu/surface-remote`'s
`readPublishedClosure` reads:

    <directory>/<rev>/<system>/<attr>.json    = {"rev": …, "ia": …, "ca": …}
    <directory>/latest/<system>/<attr>.json   = {"rev": …, "ia": …, "ca": …}

`<rev>` is the KEY a consumer looks itself up by (for a `mkProvenAgentSource`
binder, its source's `commit-hash`); `"rev"` inside is the full commit.

**A Mac gets no rewrite.** The rewrite edits every file in the closure that
embeds a store path, a Mach-O among them, which invalidates its ad-hoc
signature; arm64 macOS then kills it on exec. A `*-darwin` entry names the
signed path alone (`{"rev": …, "ia": …}`).

Subcommands, one per step of `action.yml`:

    resolve  — the inputs, made concrete: the installables, the declaration
               (caches + index), the index key; written as step outputs.
    index    — build each installable, rewrite it (off darwin), write entries.
    paths    — every store path the entries name (ia, and ca), one per line.
    smoke    — run each rewritten closure's declared program (Linux only).
    verify   — import each published path from the cache into a throwaway
               store with this Nix, and verify it.
"""
import argparse
import json
import pathlib
import re
import subprocess
import sys

# An attribute names the index file, so nothing that could climb out of the
# directory is allowed through.
ATTR = re.compile(r"[A-Za-z_][A-Za-z0-9_'-]*")
# The baked source's file names, from the registry Nix writes them by and
# TypeScript reads them by (`packages/surface-remote/agent-env.json`) — the
# action's checkout is the whole kolu repository, so it is beside this script.
AGENT_ENV = json.loads(
    (pathlib.Path(__file__).resolve().parents[3] / "packages/surface-remote/agent-env.json").read_text())
STORE_PATH = re.compile(r"/nix/store/[0-9a-z]{32}-[^/]+")
FULL_REV = re.compile(r"[0-9a-f]{40}")


def die(message: str):
    sys.exit(f"publish-closure: {message}")


def nix(args: list) -> str:
    """What `nix ARGS` prints, or exit naming what nix said."""
    result = subprocess.run(["nix", *args], capture_output=True, text=True)
    if result.returncode != 0:
        detail = result.stderr.strip().splitlines()
        die(f"nix {' '.join(args)}: {detail[-1] if detail else result.returncode}")
    return result.stdout


def nix_json(args: list):
    text = nix(args)
    try:
        return json.loads(text)
    except json.JSONDecodeError as error:
        die(f"nix {' '.join(args)}: unreadable JSON: {error}")


def segment(name: str, value: str) -> str:
    if not value or "/" in value or value.startswith("."):
        die(f"{name} {value!r} cannot name an index directory")
    return value


def attr_of(installable: str) -> str:
    """The attribute an installable names — the last component after `#`."""
    attr = installable.rsplit("#", 1)[-1].rsplit(".", 1)[-1]
    if "#" not in installable or not ATTR.fullmatch(attr):
        die(f"{installable}: {attr!r} is not an attribute name")
    return attr


def read_declaration(sidecar: str) -> dict:
    """The declaration a binder bakes (`binary-cache.json`): a path to it, or
    its JSON inline. Needs a substituter (the cache this publishes to) and an
    index (where the entries go)."""
    try:
        text = sidecar if sidecar.lstrip().startswith("{") else pathlib.Path(sidecar).read_text()
    except OSError as error:
        die(f"the sidecar cannot be read: {error}")
    try:
        declaration = json.loads(text)
    except json.JSONDecodeError as error:
        die(f"the sidecar is not JSON: {error}")
    substituters = declaration.get("substituters") or []
    index = declaration.get("index")
    if not substituters or not all(isinstance(s, str) and s for s in substituters):
        die("the sidecar names no substituter to publish to")
    if not isinstance(index, dict) or not index.get("repo") or not index.get("branch"):
        die("the sidecar declares no closure index ({ repo, branch }) — nothing to publish to")
    return declaration


def attic_target(cache_url: str) -> tuple:
    """`https://host/name` → (`https://host`, `name`): attic serves a cache
    at its server URL plus the cache's name."""
    match = re.fullmatch(r"(https://[^/]+(?:/[^/]+)*)/([^/]+)/?", cache_url)
    if match is None:
        die(f"{cache_url} is not an attic cache URL (https://<server>/<cache>)")
    return match.group(1), match.group(2)


def resolve(args) -> int:
    """Make the inputs concrete, as `key=value` lines for `$GITHUB_OUTPUT`."""
    if args.source:
        if args.sidecar or args.rev_key:
            die("`source` names the sidecar and the key itself — pass neither `sidecar` nor `rev` with it")
        source = nix(["build", "--no-link", "--print-out-paths", args.source]).strip()
        if not STORE_PATH.fullmatch(source):
            die(f"{args.source} built {source!r}, not one store path")
        sidecar = str(pathlib.Path(source) / AGENT_ENV["binaryCacheFile"])
        try:
            rev_key = (pathlib.Path(source) / AGENT_ENV["commitHashFile"]).read_text().strip()
        except OSError as error:
            die(f"{args.source} is not a baked agent source: {error}")
        installables = [f"{source}#{attr}" for attr in args.installables]
    else:
        if not args.sidecar or not args.rev_key:
            die("without `source`, both `sidecar` and `rev` are required")
        sidecar, rev_key, installables = args.sidecar, args.rev_key, list(args.installables)
    if not installables:
        die("no installables to publish")
    for installable in installables:
        attr_of(installable)
    segment("rev", rev_key)
    if not FULL_REV.fullmatch(args.rev):
        die(f"the full revision {args.rev!r} is not a 40-hex commit")
    if not args.rev.startswith(rev_key):
        # A dirty or foreign source would key entries no consumer built.
        die(f"the index key {rev_key!r} is not a prefix of the commit {args.rev} — refusing to publish it")
    declaration = read_declaration(sidecar)
    if declaration["index"]["repo"] != args.repository:
        # The declaration is the source of truth for where entries go; this
        # run can only push the branch of the repository it runs in.
        die(f"the declaration publishes to {declaration['index']['repo']}, "
            f"but this run is in {args.repository} — run it in the declared repository")
    cache = declaration["substituters"][0]
    server, name = attic_target(cache)
    outputs = {
        "installables": " ".join(installables),
        "rev-key": rev_key,
        "cache": cache,
        "attic-server": server,
        "attic-cache": name,
        "index-branch": declaration["index"]["branch"],
    }
    for key, value in outputs.items():
        print(f"{key}={value}")
    return 0


def content_addressed(ia: str) -> str:
    """`ia`'s content-addressed rewrite, checked against what the store says."""
    rewrites = nix_json(["store", "make-content-addressed", "--json", ia]).get("rewrites")
    ca = rewrites.get(ia) if isinstance(rewrites, dict) else None
    if not isinstance(ca, str) or not STORE_PATH.fullmatch(ca):
        die(f"nix rewrote no path for {ia}: {ca!r}")
    info = nix_json(["path-info", "--json-format", "1", "--json", ca])
    entry = info.get(ca) if isinstance(info, dict) else None
    if not isinstance(entry, dict) or not str(entry.get("ca") or "").startswith("fixed:"):
        die(f"{ca} is not content-addressed in the store: {entry!r}")
    return ca


def write(path: pathlib.Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def index(args) -> int:
    segment("rev", args.rev_key)
    segment("system", args.system)
    if not FULL_REV.fullmatch(args.rev) or not args.rev.startswith(args.rev_key):
        die(f"the key {args.rev_key!r} and the commit {args.rev!r} do not agree")
    signed_only = args.system.endswith("-darwin")
    for installable in args.installables:
        attr = attr_of(installable)
        paths = [p for p in nix(["build", "--no-link", "--print-out-paths", installable]).split() if p]
        if len(paths) != 1 or not STORE_PATH.fullmatch(paths[0]):
            die(f"{installable}: nix build printed {paths}, not one store path")
        ia = paths[0]
        entry = {"rev": args.rev, "ia": ia}
        if signed_only:
            print(f"publish-closure: {args.system}/{attr}.json: {ia} (signed: a rewritten Mach-O is killed on arm64 macOS)")
        else:
            entry["ca"] = content_addressed(ia)
            print(f"publish-closure: {args.system}/{attr}.json: {ia} -> {entry['ca']}")
        write(args.directory / args.rev_key / args.system / f"{attr}.json", entry)
        if args.latest:
            write(args.directory / "latest" / args.system / f"{attr}.json", entry)
            print(f"publish-closure: latest/{args.system}/{attr}.json: {args.rev}")
    return 0


def entries(directory: pathlib.Path, rev_key: str, system: str) -> list:
    folder = directory / rev_key / system
    found = sorted(folder.glob("*.json")) if folder.is_dir() else []
    if not found:
        die(f"no entries under {folder}")
    return [(path.stem, json.loads(path.read_text())) for path in found]


def paths(args) -> int:
    """Every store path the entries name — the signed `ia` and, off darwin,
    the content-addressed `ca` — one per line: what the cache must hold."""
    for _, entry in entries(args.directory, args.rev_key, args.system):
        print(entry["ia"])
        if entry.get("ca"):
            print(entry["ca"])
    return 0


def parse_smoke(spec: str) -> dict:
    """`<attr>=<relative bin> <args>…`, one per line → {attr: [bin, *args]}."""
    commands = {}
    for line in spec.splitlines():
        line = line.strip()
        if not line:
            continue
        attr, sep, command = line.partition("=")
        words = command.split()
        if not sep or not ATTR.fullmatch(attr.strip()) or not words:
            die(f"smoke line {line!r} is not `<attr>=<relative bin> <args>`")
        program = words[0]
        if program.startswith("/") or ".." in pathlib.PurePosixPath(program).parts:
            die(f"smoke {attr}: {program!r} must be a path relative to the closure")
        if attr.strip() in commands:
            die(f"smoke {attr}: declared twice")
        commands[attr.strip()] = words
    return commands


def smoke(args) -> int:
    """Run each rewritten closure's declared program: the rewrite replaced
    every embedded store path, so this is what says the result still execs.
    Every installable of THIS invocation needs a smoke line — one with none
    would pass having proven nothing — and a line naming no installable here
    is a typo, refused."""
    commands = parse_smoke(args.smoke)
    attrs = {attr_of(i) for i in args.installables}
    if set(commands) - attrs:
        die(f"smoke names {sorted(set(commands) - attrs)}, which this run does not publish")
    if attrs - set(commands):
        die(f"no smoke declared for {sorted(attrs - set(commands))} — every installable needs one")
    for attr, entry in entries(args.directory, args.rev_key, args.system):
        if attr not in attrs:
            continue
        ca = entry.get("ca")
        if not ca:
            die(f"smoke {attr}: the {args.system} entry names no content-addressed path")
        program, *rest = commands[attr]
        command = [f"{ca}/{program}", *rest]
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode != 0:
            die(f"smoke {attr}: {' '.join(command)} exited {result.returncode}: {result.stderr.strip()[-400:]}")
        print(f"publish-closure: smoke {attr}: {' '.join(command)} ran")
    return 0


def verify(args) -> int:
    """What a consumer does, done here with the publishing Nix: import each
    published content-addressed path from the cache into a throwaway store and
    verify it. 2.34 and 2.35 refuse each other's rewrite (`ca hash mismatch
    importing path`, agent-distro#102), so this is what says the publication
    targets the Nix line consumers verify on."""
    store = f"local?root={args.store_root}"
    for attr, entry in entries(args.directory, args.rev_key, args.system):
        ca = entry.get("ca")
        if not ca:
            continue
        print(f"publish-closure: verify {attr}: importing {ca} from {args.cache}")
        nix(["--extra-experimental-features", "nix-command",
                       "copy", "--from", args.cache, "--to", store, ca])
        nix(["--extra-experimental-features", "nix-command",
                       "store", "verify", "--store", store, "--recursive", ca])
    print("publish-closure: what was published imports and verifies")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("resolve")
    p.add_argument("--source", default="")
    p.add_argument("--sidecar", default="")
    p.add_argument("--rev-key", default="")
    p.add_argument("--rev", required=True, help="the full commit the closures were built from")
    p.add_argument("--repository", required=True, help="the repository this run pushes to (owner/name)")
    p.add_argument("installables", nargs="*")
    p.set_defaults(run=resolve)

    def entry_args(p):
        p.add_argument("--rev-key", required=True)
        p.add_argument("--system", required=True)
        p.add_argument("--directory", required=True, type=pathlib.Path)

    p = sub.add_parser("index")
    entry_args(p)
    p.add_argument("--rev", required=True)
    p.add_argument("--latest", action="store_true")
    p.add_argument("installables", nargs="+")
    p.set_defaults(run=index)

    p = sub.add_parser("paths")
    entry_args(p)
    p.set_defaults(run=paths)

    p = sub.add_parser("smoke")
    entry_args(p)
    p.add_argument("--smoke", required=True, help="`<attr>=<relative bin> <args>` lines")
    p.add_argument("installables", nargs="+")
    p.set_defaults(run=smoke)

    p = sub.add_parser("verify")
    entry_args(p)
    p.add_argument("--cache", required=True)
    p.add_argument("--store-root", required=True)
    p.set_defaults(run=verify)

    args = parser.parse_args(argv)
    return args.run(args)


if __name__ == "__main__":
    sys.exit(main())
