"""Exercise the closure publisher with a stub nix: no store here."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from urllib.parse import quote

SCRIPT = Path(__file__).resolve().parent / "publish-closure.py"
REV = "c891495" + "0" * 33
KEY = "c891495"
IA = "/nix/store/" + "a" * 32 + "-padi"
CA = "/nix/store/" + "b" * 32 + "-padi"
OTHER_IA = "/nix/store/" + "c" * 32 + "-mac"
SOURCE = "/nix/store/" + "s" * 32 + "-agent-flake-source"
CONTENT_ADDRESSED = "fixed:r:sha256:abc"
DECLARATION = {
    "substituters": ["https://cache.example.invalid/oss"],
    "trustedPublicKeys": ["oss:KEY="],
    "index": {"repo": "juspay/kolu", "branch": "ca-index",
              "rawBase": "https://raw.githubusercontent.com/juspay/kolu/ca-index"},
}
# The same declaration pointing at an odu cache bucket: one substituter at the
# origin's root, and a `pusher` saying how it is administered.
ODU_DECLARATION = dict(DECLARATION, substituters=["https://cache.kolu.dev"],
                       pusher={"kind": "odu", "bucket": "kolu"})

STUB = '''#!/usr/bin/env python3
"""A nix answering the calls publish-closure.py makes, from canned JSON."""
import json, os, sys
key = ' '.join(sys.argv[1:])
with open(os.environ['PC_CALLS'], 'a') as calls:
    calls.write(key + '\\n')
answers = json.load(open(os.environ['PC_ANSWERS']))
if key not in answers:
    sys.exit(f'stub nix: unexpected {key}')
answer = answers[key]
if isinstance(answer, dict):
    sys.stderr.write(answer.get('stderr', ''))
    sys.exit(answer['exit'])
print(answer, end='')
'''


def stub(root: Path, canned: dict) -> dict:
    tools = root / "bin"
    tools.mkdir(exist_ok=True)
    (tools / "nix").write_text(STUB)
    (tools / "nix").chmod(0o755)
    (root / "answers.json").write_text(json.dumps(canned))
    return dict(os.environ, PATH=f"{tools}:{os.environ['PATH']}",
                PC_CALLS=str(root / "calls"), PC_ANSWERS=str(root / "answers.json"))


def bundle(installable=f"{SOURCE}#padi", ia=IA, ca=CA, info=None) -> dict:
    return {
        f"build --no-link --print-out-paths {installable}": ia + "\n",
        f"store make-content-addressed --json {ia}": json.dumps({"rewrites": {ia: ca}}),
        f"path-info --json-format 1 --json {ca}": json.dumps(
            info if info is not None else {ca: {"ca": CONTENT_ADDRESSED}}),
    }


def run(root: Path, env: dict, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(SCRIPT), *args], cwd=root, env=env,
                          capture_output=True, text=True)


PUSH_STUB = '''#!/usr/bin/env python3
"""A nix/attic that records what it was asked and acts on nothing."""
import os, sys
name = os.path.basename(sys.argv[0])
root = os.environ["PC_PUSH"]
with open(os.path.join(root, "calls"), "a") as calls:
    calls.write(name + " " + " ".join(sys.argv[1:]) + "\\n")
data = sys.stdin.read()
if data:
    with open(os.path.join(root, name + ".stdin"), "a") as stdin:
        stdin.write(data)
outcome = os.environ.get(name.upper() + "_EXIT")
if outcome:
    sys.exit(int(outcome))
'''


def push_stub(root: Path) -> dict:
    """A PATH with both clients on it, recording into `root`."""
    tools = root / "bin"
    tools.mkdir(exist_ok=True)
    for name in ("nix", "attic"):
        (tools / name).write_text(PUSH_STUB)
        (tools / name).chmod(0o755)
    return dict(os.environ, PATH=f"{tools}:{os.environ['PATH']}", PC_PUSH=str(root))


def write_entries(root: Path, system="x86_64-linux", attr="padi",
                  entry=None) -> None:
    path = root / "idx" / KEY / system / f"{attr}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(entry if entry is not None else {"rev": REV, "ia": IA, "ca": CA}))


def index_args(root: Path, system="x86_64-linux", key=KEY):
    return ["index", "--rev", REV, "--rev-key", key, "--system", system,
            "--directory", str(root / "idx")]


class Index(unittest.TestCase):
    def test_a_linux_entry_names_both_forms_under_the_key_and_the_full_rev(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            r = run(root, stub(root, bundle()), *index_args(root), f"{SOURCE}#padi")
            self.assertEqual(r.returncode, 0, r.stderr)
            entry = json.loads((root / "idx" / KEY / "x86_64-linux" / "padi.json").read_text())
            self.assertEqual(entry, {"rev": REV, "ia": IA, "ca": CA})
            self.assertFalse((root / "idx" / "latest").exists())

    def test_latest_names_the_same_entry(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            r = run(root, stub(root, bundle()), *index_args(root), "--latest", f"{SOURCE}#padi")
            self.assertEqual(r.returncode, 0, r.stderr)
            latest = json.loads((root / "idx" / "latest" / "x86_64-linux" / "padi.json").read_text())
            self.assertEqual(latest, {"rev": REV, "ia": IA, "ca": CA})

    def test_a_darwin_entry_is_signed_only_and_nothing_is_rewritten(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            env = stub(root, {f"build --no-link --print-out-paths {SOURCE}#padi": IA + "\n"})
            r = run(root, env, *index_args(root, "aarch64-darwin"), f"{SOURCE}#padi")
            self.assertEqual(r.returncode, 0, r.stderr)
            entry = json.loads((root / "idx" / KEY / "aarch64-darwin" / "padi.json").read_text())
            self.assertEqual(entry, {"rev": REV, "ia": IA})
            self.assertNotIn("make-content-addressed", (root / "calls").read_text())

    def test_a_rewrite_the_store_does_not_read_as_content_addressed_is_refused(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            env = stub(root, bundle(info={CA: {"ca": None}}))
            r = run(root, env, *index_args(root), f"{SOURCE}#padi")
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("is not content-addressed", r.stderr)
            self.assertFalse((root / "idx").exists())

    def test_a_key_the_commit_does_not_start_with_is_refused(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            r = run(root, stub(root, bundle()), *index_args(root, key="c891495-dirty"), f"{SOURCE}#padi")
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("do not agree", r.stderr)

    def test_an_attribute_that_could_climb_out_is_refused(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            r = run(root, stub(root, {}), *index_args(root), f"{SOURCE}#../x")
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("is not an attribute name", r.stderr)

    def test_the_attribute_is_the_last_component_of_a_dotted_installable(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            installable = ".#packages.x86_64-linux.padi"
            r = run(root, stub(root, bundle(installable)), *index_args(root), installable)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertTrue((root / "idx" / KEY / "x86_64-linux" / "padi.json").exists())


class Resolve(unittest.TestCase):
    def test_source_mode_reads_the_declaration_and_key_from_the_baked_source(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            # The built source is a store path that is not on this disk, so the
            # read fails — which proves WHICH file the key is read from.
            env = stub(root, {"build --no-link --print-out-paths .#agent-flake-source": SOURCE + "\n"})
            r = run(root, env, "resolve", "--rev", REV, "--repository", "juspay/kolu", "--source", ".#agent-flake-source", "padi", "kaval")
            self.assertNotEqual(r.returncode, 0)
            self.assertIn(f"{SOURCE}/commit-hash", r.stderr)

    def test_sidecar_mode_names_the_cache_pusher_and_branch(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            r = run(root, stub(root, {}), "resolve", "--rev", REV, "--repository", "juspay/kolu", "--sidecar", json.dumps(DECLARATION),
                    "--rev-key", KEY, ".#padi", ".#kaval")
            self.assertEqual(r.returncode, 0, r.stderr)
            out = dict(line.split("=", 1) for line in r.stdout.splitlines())
            self.assertEqual(out["installables"], ".#padi .#kaval")
            self.assertEqual(out["rev-key"], KEY)
            self.assertEqual(out["cache"], "https://cache.example.invalid/oss")
            # No `pusher` field: the default, and the only shape every
            # declaration written before the field existed has.
            self.assertEqual(out["pusher"], "attic")
            self.assertEqual(out["index-branch"], "ca-index")
            self.assertNotIn("odu-bucket", out)
            self.assertNotIn("extra-trusted-public-keys", out)

    def test_a_declaration_for_another_repository_is_refused(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            r = subprocess.run([sys.executable, str(SCRIPT), "resolve", "--rev", REV, "--repository", "someone/fork",
                                "--sidecar", json.dumps(DECLARATION), "--rev-key", KEY, ".#padi"],
                               cwd=root, env=stub(root, {}), capture_output=True, text=True)
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("publishes to juspay/kolu, but this run is in someone/fork", r.stderr)

    def test_a_sidecar_with_no_index_has_nowhere_to_publish(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            declaration = dict(DECLARATION, index=None)
            r = run(root, stub(root, {}), "resolve", "--rev", REV, "--repository", "juspay/kolu", "--sidecar", json.dumps(declaration),
                    "--rev-key", KEY, ".#padi")
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("declares no closure index", r.stderr)

    def test_a_dirty_key_is_refused(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            r = run(root, stub(root, {}), "resolve", "--rev", REV, "--repository", "juspay/kolu", "--sidecar", json.dumps(DECLARATION),
                    "--rev-key", "c891495-dirty", ".#padi")
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("refusing to publish", r.stderr)

    def test_source_and_sidecar_together_are_refused(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            r = run(root, stub(root, {}), "resolve", "--rev", REV, "--repository", "juspay/kolu", "--source", ".#s",
                    "--sidecar", json.dumps(DECLARATION), "padi")
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("pass neither", r.stderr)


class Pusher(unittest.TestCase):
    """HOW the first substituter is pushed is the declaration's own `pusher`:
    attic (absent, or explicit) or an odu bucket. No action input decides it."""

    def resolve(self, root, declaration):
        return run(root, stub(root, {}), "resolve", "--rev", REV, "--repository", "juspay/kolu",
                   "--sidecar", json.dumps(declaration), "--rev-key", KEY, ".#padi")

    def outputs(self, root, declaration):
        r = self.resolve(root, declaration)
        self.assertEqual(r.returncode, 0, r.stderr)
        return dict(line.split("=", 1) for line in r.stdout.splitlines())

    def test_an_explicit_attic_pusher_is_the_default_spelled_out(self):
        with tempfile.TemporaryDirectory() as d:
            out = self.outputs(Path(d), dict(DECLARATION, pusher={"kind": "attic"}))
            self.assertEqual(out["pusher"], "attic")
            self.assertEqual(out["cache"], "https://cache.example.invalid/oss")

    def test_an_odu_pusher_names_its_bucket(self):
        with tempfile.TemporaryDirectory() as d:
            out = self.outputs(Path(d), ODU_DECLARATION)
            self.assertEqual(out["pusher"], "odu")
            self.assertEqual(out["odu-bucket"], "kolu")
            self.assertEqual(out["cache"], "https://cache.kolu.dev")

    def test_a_bucket_served_under_a_path_is_accepted(self):
        with tempfile.TemporaryDirectory() as d:
            declaration = dict(ODU_DECLARATION, substituters=["https://cache.kolu.dev/cache/kolu"])
            self.assertEqual(self.outputs(Path(d), declaration)["pusher"], "odu")

    def test_a_bucket_the_substituter_does_not_serve_is_refused(self):
        with tempfile.TemporaryDirectory() as d:
            declaration = dict(ODU_DECLARATION, substituters=["https://cache.kolu.dev/cache/other"])
            r = self.resolve(Path(d), declaration)
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("is not that bucket", r.stderr)

    def test_a_pusher_with_no_bucket_is_refused(self):
        with tempfile.TemporaryDirectory() as d:
            r = self.resolve(Path(d), dict(ODU_DECLARATION, pusher={"kind": "odu"}))
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("names no bucket", r.stderr)

    def test_a_pusher_kind_this_publisher_does_not_know_is_refused(self):
        with tempfile.TemporaryDirectory() as d:
            r = self.resolve(Path(d), dict(ODU_DECLARATION, pusher={"kind": "s3", "bucket": "kolu"}))
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("not one this publisher knows", r.stderr)

    def test_a_misspelt_pusher_key_is_refused_rather_than_dropped(self):
        with tempfile.TemporaryDirectory() as d:
            pusher = {"kind": "odu", "bucket": "kolu", "origin": "https://elsewhere"}
            r = self.resolve(Path(d), dict(ODU_DECLARATION, pusher=pusher))
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("does not take", r.stderr)

    def test_a_pusher_that_is_not_an_object_is_refused(self):
        with tempfile.TemporaryDirectory() as d:
            r = self.resolve(Path(d), dict(ODU_DECLARATION, pusher="odu"))
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("must be an object", r.stderr)

    def test_a_non_https_substituter_is_refused_for_odu(self):
        with tempfile.TemporaryDirectory() as d:
            declaration = dict(ODU_DECLARATION, substituters=["http://cache.kolu.dev"])
            r = self.resolve(Path(d), declaration)
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("not an https substituter URL", r.stderr)


class Push(unittest.TestCase):
    """The step that hands the entries' paths to a client — driven here, not by
    hand: both pushers, the exact argv, and that a failing client fails the
    publication."""

    PIN = json.loads((Path(__file__).resolve().parents[3] / "npins/sources.json").read_text())["pins"]["odu"]

    def push(self, root, *extra, env=None):
        return run(root, env if env is not None else push_stub(root),
                   "push", "--rev-key", KEY, "--system", "x86_64-linux",
                   "--directory", str(root / "idx"), *extra)

    def calls(self, root):
        return (root / "calls").read_text().splitlines()

    def test_an_odu_pusher_runs_the_pinned_odu_with_the_bucket_and_its_origin(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            write_entries(root)
            r = self.push(root, "--cache", "https://cache.kolu.dev", "--pusher", "odu", "--bucket", "kolu")
            self.assertEqual(r.returncode, 0, r.stderr)
            ref = f"{self.PIN['url']}?narHash={quote(self.PIN['hash'])}"
            self.assertEqual(self.calls(root), [
                f"nix run --accept-flake-config {ref}#odu -- "
                f"cache push kolu --origin https://cache.kolu.dev {IA} {CA}",
            ])

    def test_an_odu_bucket_served_under_a_path_keeps_the_origin(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            write_entries(root)
            r = self.push(root, "--cache", "https://cache.kolu.dev/cache/kolu", "--pusher", "odu", "--bucket", "kolu")
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn("--origin https://cache.kolu.dev ", self.calls(root)[0])

    def test_an_attic_pusher_runs_the_same_three_calls_over_the_same_paths(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            write_entries(root)
            env = dict(push_stub(root), ATTIC_TOKEN="t")
            r = self.push(root, "--cache", "https://cache.example.invalid/oss", "--pusher", "attic",
                         "--attic-nixpkgs", "https://example/nixpkgs.tar.gz", env=env)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual(self.calls(root), [
                "nix profile add https://example/nixpkgs.tar.gz#attic-client",
                "attic login --set-default publish https://cache.example.invalid t",
                "attic push --stdin publish:oss",
            ])
            self.assertEqual((root / "attic.stdin").read_text(), f"{IA}\n{CA}\n")

    def test_a_failing_client_fails_the_publication(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            write_entries(root)
            env = dict(push_stub(root), NIX_EXIT="1")
            r = self.push(root, "--cache", "https://cache.kolu.dev", "--pusher", "odu", "--bucket", "kolu", env=env)
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("exited 1", r.stderr)

    def test_the_bucket_belongs_to_odu_only(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            write_entries(root)
            r = self.push(root, "--cache", "https://cache.example.invalid/oss", "--pusher", "attic",
                         "--bucket", "kolu", "--attic-nixpkgs", "x", env=dict(push_stub(root), ATTIC_TOKEN="t"))
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("takes no --bucket", r.stderr)

    def test_an_odu_pusher_without_a_bucket_is_refused(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            write_entries(root)
            r = self.push(root, "--cache", "https://cache.kolu.dev", "--pusher", "odu")
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("needs --bucket", r.stderr)

    def test_a_bucket_at_a_shape_odu_does_not_serve_is_refused(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            write_entries(root)
            r = self.push(root, "--cache", "https://cache.kolu.dev/kolu", "--pusher", "odu", "--bucket", "kolu")
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("is not that bucket", r.stderr)

    def test_an_attic_pusher_without_its_token_is_refused_not_skipped(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            write_entries(root)
            env = dict(push_stub(root), ATTIC_TOKEN="")
            r = self.push(root, "--cache", "https://cache.example.invalid/oss", "--pusher", "attic",
                         "--attic-nixpkgs", "x", env=env)
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("no ATTIC_TOKEN", r.stderr)

    def test_an_attic_pusher_needs_the_callers_pinned_nixpkgs(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            write_entries(root)
            env = dict(push_stub(root), ATTIC_TOKEN="t")
            r = self.push(root, "--cache", "https://cache.example.invalid/oss", "--pusher", "attic", env=env)
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("needs --attic-nixpkgs", r.stderr)


class Smoke(unittest.TestCase):
    def write_entry(self, root: Path, entry: dict, attr="padi", system="x86_64-linux"):
        path = root / "idx" / KEY / system / f"{attr}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(entry))

    def program(self, root: Path, body: str) -> Path:
        ca = root / "ca"
        (ca / "bin").mkdir(parents=True)
        (ca / "bin" / "padi").write_text(body)
        (ca / "bin" / "padi").chmod(0o755)
        return ca

    def smoke(self, root, spec, *installables):
        return run(root, stub(root, {}), "smoke", "--rev-key", KEY, "--system", "x86_64-linux",
                   "--directory", str(root / "idx"), "--smoke", spec, *installables)

    def test_a_program_that_runs_passes(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            ca = self.program(root, '#!/bin/sh\n[ "$1" = --help ]\n')
            self.write_entry(root, {"rev": REV, "ia": IA, "ca": str(ca)})
            r = self.smoke(root, "padi=bin/padi --help", f"{SOURCE}#padi")
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn("--help ran", r.stdout)

    def test_a_program_that_does_not_exec_fails_the_publication(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            ca = self.program(root, "#!/bin/sh\necho broken >&2\nexit 3\n")
            self.write_entry(root, {"rev": REV, "ia": IA, "ca": str(ca)})
            r = self.smoke(root, "padi=bin/padi --help", f"{SOURCE}#padi")
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("exited 3", r.stderr)

    def test_an_installable_with_no_smoke_line_fails_never_skips(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            r = self.smoke(root, "padi=bin/padi --help", f"{SOURCE}#padi", f"{SOURCE}#kaval")
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("no smoke declared for ['kaval']", r.stderr)

    def test_a_smoke_line_for_an_attr_not_published_here_is_refused(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            r = self.smoke(root, "padi=bin/padi\nkavla=bin/kaval", f"{SOURCE}#padi")
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("['kavla']", r.stderr)

    def test_an_absolute_or_climbing_program_is_refused(self):
        for line in ("padi=/bin/sh -c true", "padi=../x"):
            with tempfile.TemporaryDirectory() as d:
                root = Path(d)
                r = self.smoke(root, line, f"{SOURCE}#padi")
                self.assertNotEqual(r.returncode, 0)
                self.assertIn("relative to the closure", r.stderr)

    def test_only_this_invocations_entries_are_run(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            ca = self.program(root, "#!/bin/sh\nexit 0\n")
            self.write_entry(root, {"rev": REV, "ia": IA, "ca": str(ca)})
            # An entry from another run in the same tree: not ours to smoke.
            self.write_entry(root, {"rev": REV, "ia": IA, "ca": "/nonexistent"}, attr="other")
            r = self.smoke(root, "padi=bin/padi", f"{SOURCE}#padi")
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertNotIn("other", r.stdout)


class Verify(unittest.TestCase):
    def test_imports_each_content_addressed_path_into_a_throwaway_store(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            for attr, entry in [("padi", {"rev": REV, "ia": IA, "ca": CA}), ("other", {"rev": REV, "ia": IA})]:
                path = root / "idx" / KEY / "x86_64-linux" / f"{attr}.json"
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(entry))
            store = f"local?root={root}/v"
            env = stub(root, {
                f"--extra-experimental-features nix-command copy --from https://c/oss --to {store} {CA}": "",
                f"--extra-experimental-features nix-command store verify --store {store} --recursive {CA}": "",
            })
            r = run(root, env, "verify", "--rev-key", KEY, "--system", "x86_64-linux",
                    "--directory", str(root / "idx"), "--cache", "https://c/oss", "--store-root", f"{root}/v")
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual(len((root / "calls").read_text().splitlines()), 2)

    def test_a_hash_mismatch_fails_the_publication(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            path = root / "idx" / KEY / "x86_64-linux" / "padi.json"
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps({"rev": REV, "ia": IA, "ca": CA}))
            store = f"local?root={root}/v"
            env = stub(root, {
                f"--extra-experimental-features nix-command copy --from https://c/oss --to {store} {CA}":
                    {"exit": 1, "stderr": "error: ca hash mismatch importing path\n"},
            })
            r = run(root, env, "verify", "--rev-key", KEY, "--system", "x86_64-linux",
                    "--directory", str(root / "idx"), "--cache", "https://c/oss", "--store-root", f"{root}/v")
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("ca hash mismatch", r.stderr)


class Archive(unittest.TestCase):
    """A remote `uses: juspay/kolu/.github/actions/publish-closure@<rev>`
    resolves from GitHub's archive of that rev, which honours `export-ignore`:
    the action must be in `git archive`, the workflows need not be."""

    def test_git_archive_carries_the_action(self):
        repo = SCRIPT.parents[3]
        names = subprocess.run(
            ["git", "-C", str(repo), "archive", "--format=tar", "HEAD"],
            capture_output=True, check=True).stdout
        listing = subprocess.run(["tar", "t"], input=names, capture_output=True, check=True).stdout.decode()
        members = set(listing.split())
        for path in ("action.yml", "publish-closure.py"):
            self.assertIn(f".github/actions/publish-closure/{path}", members)
        self.assertFalse(any(m.startswith(".github/workflows/") for m in members))


if __name__ == "__main__":
    unittest.main()
