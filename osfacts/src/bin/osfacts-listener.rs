//! Helper binary for hermetic CLI tests: bind an address, print a line, park
//! until killed.
//!
//! Two modes, because the binary answers two questions about sockets:
//! `osfacts-listener <IP> [--spin]` binds a TCP port and prints it (the
//! `snapshot --ports` fixtures), and `osfacts-listener --unix <PATH>` binds a
//! unix socket and prints `bound` (the `socket-holders` fixtures).
//!
//! Located by tests via `CARGO_BIN_EXE_osfacts-listener`. Keep the Child handle
//! alive and kill+wait on drop — a zombie still sits in the pid table and
//! corrupts snapshots.

use std::env;
use std::io::{self, Write};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, TcpListener};
use std::os::unix::net::UnixListener;
use std::thread;
use std::time::Duration;

fn main() {
    let mut args = env::args().skip(1);
    let bind = args.next().unwrap_or_else(|| "127.0.0.1".into());
    if bind == "--unix" {
        let path = args.next().unwrap_or_else(|| {
            eprintln!("osfacts-listener: --unix needs a PATH");
            std::process::exit(2);
        });
        // Held for the process's whole life: dropping it would close the
        // socket and unbind the path the test is about to ask about.
        let _bound = match UnixListener::bind(&path) {
            Ok(l) => l,
            Err(e) => {
                eprintln!("osfacts-listener: bind {path}: {e}");
                std::process::exit(1);
            }
        };
        announce("bound");
        park(false);
    }
    let spin = args.next().as_deref() == Some("--spin");
    let addr: SocketAddr = match bind.as_str() {
        "127.0.0.1" => SocketAddr::from((Ipv4Addr::LOCALHOST, 0)),
        "0.0.0.0" => SocketAddr::from((Ipv4Addr::UNSPECIFIED, 0)),
        "::1" => SocketAddr::from((Ipv6Addr::LOCALHOST, 0)),
        "::" => SocketAddr::from((Ipv6Addr::UNSPECIFIED, 0)),
        "::ffff:127.0.0.1" => {
            let mapped = Ipv6Addr::new(0, 0, 0, 0, 0, 0xffff, 0x7f00, 0x0001);
            SocketAddr::new(IpAddr::V6(mapped), 0)
        }
        other => {
            eprintln!("osfacts-listener: unknown bind '{other}'");
            std::process::exit(2);
        }
    };

    let listener = match TcpListener::bind(addr) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("osfacts-listener: bind {addr}: {e}");
            std::process::exit(1);
        }
    };
    let port = listener.local_addr().expect("local_addr").port();
    announce(&port.to_string());
    park(spin);
}

/// One line, flushed: the parent reads it as proof the bind completed before
/// it snapshots.
fn announce(line: &str) {
    let mut out = io::stdout().lock();
    writeln!(out, "{line}").expect("write announce line");
    out.flush().expect("flush announce line");
}

/// Park (or burn CPU for the cumulative CPU-time fixture). The parent kills
/// us; we must not exit on our own.
fn park(spin: bool) -> ! {
    loop {
        if spin {
            std::hint::spin_loop();
        } else {
            thread::sleep(Duration::from_secs(3600));
        }
    }
}
