//! Lane 1 — the mandatory `unreadable` contract.
//!
//! No root required. On a real host, pid 1's fd table is always forbidden to a
//! normal-uid reader (`EACCES` on linux `/proc/1/fd`, `EPERM` on darwin
//! libproc for launchd). Inside the nix sandbox pid 1 is the builder's own
//! init as the same uid, so that path is readable — the vanished-pid case
//! still pins the U-row contract there.

mod common;

use common::{osfacts, parse_tsv};

#[test]
fn pid_one_ports_yields_u_row() {
    #[cfg(target_os = "linux")]
    {
        // Precondition: /proc/1/fd must actually be denied. The nix sandbox's
        // pid 1 is a same-uid bash, so readdir succeeds and the fixture does
        // not apply — vanished_pid_yields_u_row covers the U-row contract.
        if std::fs::read_dir("/proc/1/fd").is_ok() {
            eprintln!(
                "note: /proc/1/fd is readable (nix sandbox topology); \
                 pid-1 EACCES fixture N/A — see vanished_pid_yields_u_row"
            );
            return;
        }
    }

    let out = osfacts()
        .args(["snapshot", "--pids", "1", "--procs", "--ports"])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let stdout = String::from_utf8(out).unwrap();
    let (v, _procs, _ports, unreadable) = parse_tsv(&stdout);
    assert_eq!(v, 1);
    assert!(
        unreadable.iter().any(|u| {
            u.starts_with("U\t1\t")
                && (u.contains("EACCES") || u.contains("EPERM") || u.contains("ESRCH"))
        }),
        "expected a U row for pid 1 with a permission errno; unreadable={unreadable:?}\nfull:\n{stdout}"
    );
}

#[test]
fn vanished_pid_yields_u_row() {
    let gone = 2_147_483_646u32;
    let out = osfacts()
        .args([
            "snapshot",
            "--pids",
            &gone.to_string(),
            "--procs",
            "--ports",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let stdout = String::from_utf8(out).unwrap();
    let (v, procs, _, unreadable) = parse_tsv(&stdout);
    assert_eq!(v, 1);
    assert!(
        procs
            .iter()
            .all(|p| !p.starts_with(&format!("P\t{gone}\t"))),
        "must not invent a P row for a vanished pid"
    );
    assert!(
        unreadable
            .iter()
            .any(|u| u.starts_with(&format!("U\t{gone}\t"))),
        "expected a U row for pid {gone}; unreadable={unreadable:?}"
    );
}
