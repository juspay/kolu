//! Helper binary for hermetic CLI tests: bind a TCP address, print the port,
//! park until killed.
//!
//! Located by tests via `CARGO_BIN_EXE_osfacts-listener`. Keep the Child handle
//! alive and kill+wait on drop — a zombie still sits in the pid table and
//! corrupts snapshots.

use std::env;
use std::io::{self, Write};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, TcpListener};
use std::thread;
use std::time::Duration;

fn main() {
    let bind = env::args().nth(1).unwrap_or_else(|| "127.0.0.1".into());
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
    // One line, flushed: tests read the port before the process parks.
    let mut out = io::stdout().lock();
    writeln!(out, "{port}").expect("write port");
    out.flush().expect("flush port");

    // Park. The parent kills us; we must not exit on our own.
    loop {
        thread::sleep(Duration::from_secs(3600));
    }
}
