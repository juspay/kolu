"""Exercise the closure publisher with a stub nix: no store here."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parent / "publish-closure.py"
REV = "c891495" + "0" * 33
KEY = "c891495"
IA = "/nix/store/" + "a" * 32 + "-padi"
CA = "/nix/store/" + "b" * 32 + "-padi"
SOURCE = "/nix/store/" + "s" * 32 + "-agent-flake-source"
CONTENT_ADDRESSED = "fixed:r:sha256:abc"
DECLARATION = {
    "substituters": ["https://cache.nixos.asia/oss"],
    "trustedPublicKeys": ["oss:KEY="],
    "index": {"repo": "juspay/kolu", "branch": "ca-index",
              "rawBase": "https://raw.githubusercontent.com/juspay/kolu/ca-index"},
}

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

    def test_sidecar_mode_names_the_cache_attic_target_and_branch(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            r = run(root, stub(root, {}), "resolve", "--rev", REV, "--repository", "juspay/kolu", "--sidecar", json.dumps(DECLARATION),
                    "--rev-key", KEY, ".#padi", ".#kaval")
            self.assertEqual(r.returncode, 0, r.stderr)
            out = dict(line.split("=", 1) for line in r.stdout.splitlines())
            self.assertEqual(out["installables"], ".#padi .#kaval")
            self.assertEqual(out["rev-key"], KEY)
            self.assertEqual(out["cache"], "https://cache.nixos.asia/oss")
            self.assertEqual(out["attic-server"], "https://cache.nixos.asia")
            self.assertEqual(out["attic-cache"], "oss")
            self.assertEqual(out["index-branch"], "ca-index")
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


if __name__ == "__main__":
    unittest.main()
