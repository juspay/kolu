//! Single-threaded hermetic driver: unshare user+net, bind, snapshot, print.
//!
//! The cargo/libtest harness is multi-threaded, and `unshare(CLONE_NEWUSER)`
//! returns EINVAL in a multi-threaded process. This binary re-execs under
//! util-linux `unshare` (linux only), then binds + snapshots inside the ns.
//!
//! Stdout protocol:
//!   META\t{listener_pid}\t{port}
//!   …then the raw osfacts TSV (version-first)…

use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

fn main() {
    let bind = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "127.0.0.1".into());
    let mode = std::env::args().nth(2).unwrap_or_else(|| "roots".into());

    // Re-exec under util-linux `unshare` when not already inside. Manual
    // unshare(2)+uid_map is brittle across kernel/AppArmor configs; the
    // system tool is what we measured working.
    #[cfg(target_os = "linux")]
    if std::env::var_os("OSFACTS_HERMETIC_INNER").is_none() {
        let me = std::env::current_exe().expect("current_exe");
        let status = Command::new("unshare")
            .args(["--user", "--map-root-user", "--net", "--"])
            .arg(&me)
            .env("OSFACTS_HERMETIC_INNER", "1")
            .arg(&bind)
            .arg(&mode)
            .status()
            .unwrap_or_else(|e| {
                panic!(
                    "osfacts hermetic tests require unprivileged user+net namespaces; \
                     spawning `unshare --user --map-root-user --net` failed: {e} \
                     (a misconfigured builder is a defect, never a skip)"
                )
            });
        std::process::exit(status.code().unwrap_or(1));
    }

    enter_netns_lo_only();

    let listener_bin = sibling_bin("osfacts-listener");
    let osfacts_bin = sibling_bin("osfacts");

    let mut child = Command::new(&listener_bin)
        .arg(&bind)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap_or_else(|e| panic!("spawn listener: {e}"));
    let lpid = child.id();
    let stdout = child.stdout.take().expect("listener stdout");
    let mut line = String::new();
    BufReader::new(stdout)
        .read_line(&mut line)
        .expect("read port");
    let port: u16 = line
        .trim()
        .parse()
        .unwrap_or_else(|_| panic!("bad port line: {line:?}"));

    thread::sleep(Duration::from_millis(20));

    let scope_args: Vec<String> = match mode.as_str() {
        "pids" => vec![
            "snapshot".into(),
            "--pids".into(),
            lpid.to_string(),
            "--procs".into(),
            "--ports".into(),
        ],
        "host-procs" => vec!["snapshot".into(), "--procs".into()],
        _ => vec![
            "snapshot".into(),
            "--roots".into(),
            lpid.to_string(),
            "--procs".into(),
            "--ports".into(),
        ],
    };

    let out = Command::new(&osfacts_bin)
        .args(&scope_args)
        .output()
        .unwrap_or_else(|e| panic!("run osfacts: {e}"));

    let _ = child.kill();
    let _ = child.wait();

    if !out.status.success() {
        let _ = std::io::stderr().write_all(&out.stderr);
        panic!("osfacts exited {}", out.status);
    }

    let mut stdout = std::io::stdout().lock();
    writeln!(stdout, "META\t{lpid}\t{port}").expect("meta");
    stdout.write_all(&out.stdout).expect("tsv");
}

fn sibling_bin(name: &str) -> std::path::PathBuf {
    let mut p = std::env::current_exe().expect("current_exe");
    p.set_file_name(name);
    p
}

fn enter_netns_lo_only() {
    #[cfg(target_os = "linux")]
    {
        bring_lo_up().expect("bring lo up in hermetic netns");
    }
}

#[cfg(target_os = "linux")]
fn bring_lo_up() -> std::io::Result<()> {
    use std::mem;
    unsafe {
        let fd = libc::socket(libc::AF_INET, libc::SOCK_DGRAM, 0);
        if fd < 0 {
            return Err(std::io::Error::last_os_error());
        }
        #[repr(C)]
        struct Ifreq {
            name: [u8; 16],
            flags: libc::c_short,
            _pad: [u8; 22],
        }
        let mut ifr: Ifreq = mem::zeroed();
        ifr.name[0] = b'l';
        ifr.name[1] = b'o';
        ifr.flags = (libc::IFF_UP | libc::IFF_RUNNING) as libc::c_short;
        const SIOCSIFFLAGS: libc::c_ulong = 0x8914;
        let rc = libc::ioctl(fd, SIOCSIFFLAGS, &mut ifr as *mut _);
        let err = std::io::Error::last_os_error();
        libc::close(fd);
        if rc < 0 {
            Err(err)
        } else {
            Ok(())
        }
    }
}
