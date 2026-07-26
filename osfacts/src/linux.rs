//! Linux: std-only `/proc`.
//!
//! Scope tracks the ask:
//! - `--roots` descends `/proc/<pid>/task/<tid>/children` (never the whole table)
//! - `--pids` is an exact set
//! - host-wide readdir of `/proc`
//!
//! Ports: `/proc/net/tcp{,6}` LISTEN rows joined to scoped pids via fd inodes.

use crate::cli::Scope;
use crate::schema::{errno_name, hex_bytes, sanitize_name, Port, Proc, Snapshot, Unreadable};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io;
use std::path::Path;

const TCP_LISTEN: &str = "0A";

pub fn snapshot(scope: &Scope, want_procs: bool, want_ports: bool) -> Snapshot {
    let mut snap = Snapshot::new();
    let pids = match collect_pids(scope, &mut snap) {
        Some(p) => p,
        None => return snap,
    };

    let mut table: HashMap<u32, (u32, String)> = HashMap::new();
    for &pid in &pids {
        match read_proc(pid) {
            Ok(row) => {
                table.insert(pid, (row.ppid, row.name));
            }
            Err(err) => {
                snap.unreadable.push(Unreadable {
                    pid,
                    errno: errno_name(err),
                });
            }
        }
    }

    if want_procs {
        let mut keys: Vec<u32> = table.keys().copied().collect();
        keys.sort_unstable();
        for pid in keys {
            let (ppid, name) = &table[&pid];
            snap.procs.push(Proc {
                pid,
                ppid: *ppid,
                name: name.clone(),
            });
        }
    }

    if want_ports {
        let listeners = match load_listeners() {
            Ok(m) => m,
            Err(_) => {
                // A blind internet table is fatal for the ports facet — but we
                // still return what we have (version + procs + unreadable).
                // Consumers see success with no L rows only when the table was
                // readable and empty-in-scope.
                return snap;
            }
        };
        let mut port_rows = Vec::new();
        for &pid in &pids {
            if !table.contains_key(&pid) {
                continue; // already in unreadable
            }
            match socket_inodes(pid) {
                Ok(inodes) => {
                    for inode in inodes {
                        if let Some(l) = listeners.get(&inode) {
                            port_rows.push(Port {
                                pid,
                                port: l.port,
                                address: hex_bytes(&l.addr),
                            });
                        }
                    }
                }
                Err(err) => {
                    // Don't double-report a pid already unreadable from the
                    // process read.
                    if !snap.unreadable.iter().any(|u| u.pid == pid) {
                        snap.unreadable.push(Unreadable {
                            pid,
                            errno: errno_name(err),
                        });
                    }
                }
            }
        }
        port_rows.sort_by_key(|p| (p.pid, p.port));
        snap.ports = port_rows;
    }

    snap
}

// ── scope ───────────────────────────────────────────────────────────────

fn collect_pids(scope: &Scope, snap: &mut Snapshot) -> Option<Vec<u32>> {
    match scope {
        Scope::Host => Some(host_pids()),
        Scope::Pids(list) => Some(list.clone()),
        Scope::Roots(roots) => {
            let mut seen = HashSet::new();
            let mut out = Vec::new();
            for &root in roots {
                if !seen.insert(root) {
                    continue;
                }
                // A root we cannot even begin from is unreadable, not absent.
                if !Path::new(&format!("/proc/{root}")).exists() {
                    snap.unreadable.push(Unreadable {
                        pid: root,
                        errno: errno_name(libc::ENOENT),
                    });
                    continue;
                }
                out.push(root);
                descend(root, &mut seen, &mut out);
            }
            Some(out)
        }
    }
}

fn host_pids() -> Vec<u32> {
    let mut pids = Vec::new();
    let Ok(entries) = fs::read_dir("/proc") else {
        return pids;
    };
    for ent in entries.flatten() {
        let name = ent.file_name();
        let s = name.to_string_lossy();
        if let Ok(pid) = s.parse::<u32>() {
            pids.push(pid);
        }
    }
    pids.sort_unstable();
    pids
}

/// Walk `/proc/<pid>/task/<tid>/children` breadth-first.
fn descend(root: u32, seen: &mut HashSet<u32>, out: &mut Vec<u32>) {
    let mut queue = vec![root];
    while let Some(pid) = queue.pop() {
        for child in children_of(pid) {
            if seen.insert(child) {
                out.push(child);
                queue.push(child);
            }
        }
    }
}

fn children_of(pid: u32) -> Vec<u32> {
    let task_dir = format!("/proc/{pid}/task");
    let Ok(tasks) = fs::read_dir(&task_dir) else {
        return Vec::new();
    };
    let mut kids = Vec::new();
    for task in tasks.flatten() {
        let tid = task.file_name();
        let path = format!("/proc/{pid}/task/{}/children", tid.to_string_lossy());
        let Ok(body) = fs::read_to_string(&path) else {
            continue;
        };
        for part in body.split_whitespace() {
            if let Ok(c) = part.parse::<u32>() {
                kids.push(c);
            }
        }
    }
    kids
}

// ── process ─────────────────────────────────────────────────────────────

struct ProcRow {
    ppid: u32,
    name: String,
}

fn read_proc(pid: u32) -> Result<ProcRow, i32> {
    let stat = read_file_errno(&format!("/proc/{pid}/stat"))?;
    let ppid = parse_ppid(&stat).ok_or(libc::EINVAL)?;
    let name = process_name(pid, &stat);
    Ok(ProcRow { ppid, name })
}

/// Name from cmdline argv[0] basename (MainThread lesson), else stat comm.
fn process_name(pid: u32, stat: &str) -> String {
    if let Ok(cmdline) = fs::read(format!("/proc/{pid}/cmdline")) {
        // NUL-separated argv. Empty cmdline = kernel thread → fall back.
        if let Some(argv0) = cmdline.split(|&b| b == 0).next() {
            if !argv0.is_empty() {
                let s = String::from_utf8_lossy(argv0);
                let base = s.rsplit('/').next().unwrap_or(&s);
                if !base.is_empty() {
                    return sanitize_name(base);
                }
            }
        }
    }
    sanitize_name(&parse_comm(stat).unwrap_or_else(|| pid.to_string()))
}

fn parse_comm(stat: &str) -> Option<String> {
    let open = stat.find('(')?;
    let close = stat.rfind(')')?;
    if close <= open {
        return None;
    }
    Some(stat[open + 1..close].to_string())
}

fn parse_ppid(stat: &str) -> Option<u32> {
    let close = stat.rfind(')')?;
    let rest = stat[close + 1..].trim();
    // After ')': state, ppid, …
    let mut fields = rest.split_whitespace();
    let _state = fields.next()?;
    fields.next()?.parse().ok()
}

// ── ports ───────────────────────────────────────────────────────────────

struct Listener {
    port: u16,
    addr: Vec<u8>,
}

fn load_listeners() -> io::Result<HashMap<u64, Listener>> {
    let mut map = HashMap::new();
    parse_proc_net(&fs::read_to_string("/proc/net/tcp")?, &mut map)?;
    // No IPv6 → no tcp6 file. Real absence, not a failed read.
    if let Ok(body) = fs::read_to_string("/proc/net/tcp6") {
        parse_proc_net(&body, &mut map)?;
    }
    Ok(map)
}

fn parse_proc_net(body: &str, map: &mut HashMap<u64, Listener>) -> io::Result<()> {
    let mut lines = body.lines();
    let header = lines.find(|l| l.contains("local_address"));
    if header.is_none() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "no local_address header",
        ));
    }
    for line in lines {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 10 {
            continue;
        }
        if cols[3] != TCP_LISTEN {
            continue;
        }
        let local = cols[1];
        let Some((hex_addr, hex_port)) = local.rsplit_once(':') else {
            continue;
        };
        let Ok(port) = u16::from_str_radix(hex_port, 16) else {
            continue;
        };
        if port == 0 {
            continue;
        }
        let Ok(addr) = decode_proc_address(hex_addr) else {
            continue;
        };
        let Ok(inode) = cols[9].parse::<u64>() else {
            continue;
        };
        if inode == 0 {
            continue;
        }
        map.entry(inode).or_insert(Listener { port, addr });
    }
    Ok(())
}

/// `/proc/net/tcp{,6}` prints each 32-bit word in HOST order. Reverse per
/// word to get network-order bytes (the form L rows emit).
fn decode_proc_address(hex: &str) -> Result<Vec<u8>, ()> {
    if (hex.len() != 8 && hex.len() != 32) || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(());
    }
    let mut bytes = Vec::with_capacity(hex.len() / 2);
    let raw = hex.as_bytes();
    let mut word = 0;
    while word < raw.len() {
        // four bytes, reversed
        for byte in (0..4).rev() {
            let i = word + byte * 2;
            let h = std::str::from_utf8(&raw[i..i + 2]).map_err(|_| ())?;
            bytes.push(u8::from_str_radix(h, 16).map_err(|_| ())?);
        }
        word += 8;
    }
    Ok(bytes)
}

fn socket_inodes(pid: u32) -> Result<HashSet<u64>, i32> {
    let fd_dir = format!("/proc/{pid}/fd");
    let entries = read_dir_errno(&fd_dir)?;
    let mut inodes = HashSet::new();
    for name in entries {
        let link = format!("/proc/{pid}/fd/{name}");
        let Ok(target) = fs::read_link(&link) else {
            continue; // closed between readdir and readlink
        };
        let s = target.to_string_lossy();
        // socket:[12345]
        if let Some(rest) = s.strip_prefix("socket:[") {
            if let Some(num) = rest.strip_suffix(']') {
                if let Ok(inode) = num.parse::<u64>() {
                    inodes.insert(inode);
                }
            }
        }
    }
    Ok(inodes)
}

// ── errno-preserving reads ──────────────────────────────────────────────

fn read_file_errno(path: &str) -> Result<String, i32> {
    match fs::read_to_string(path) {
        Ok(s) => Ok(s),
        Err(e) => Err(e.raw_os_error().unwrap_or(libc::EIO)),
    }
}

fn read_dir_errno(path: &str) -> Result<Vec<String>, i32> {
    match fs::read_dir(path) {
        Ok(rd) => Ok(rd
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect()),
        Err(e) => Err(e.raw_os_error().unwrap_or(libc::EIO)),
    }
}
