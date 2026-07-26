//! Darwin: one libproc pass (`proc_listpids` → `proc_pidinfo` → `proc_pidfdinfo`).
//!
//! Mirrors `packages/port-scan/native/portScanDarwin.c`. Address-slot choice
//! is `decode::slot_from_vflag` (INI_IPV6 first). No `listeners`, no `sysinfo`.
//!
//! Struct sizes/offsets verified against macOS 15.5 headers on rasam
//! (Darwin 24.5.0 arm64): socket_fdinfo=792, socket_info=768,
//! soi_family@160, soi_kind@232, in_sockinfo=80, tcp_sockinfo=120.

#![cfg(target_os = "macos")]

use crate::cli::Scope;
use osfacts::{
    errno_name, hex_bytes, sanitize_name, slot_from_vflag, AddressSlot, Port, Proc, Snapshot,
    Unreadable,
};
use std::collections::{HashMap, HashSet};
use std::ffi::CStr;
use std::mem;
use std::os::raw::{c_int, c_void};
use std::path::Path;

// ── libproc (three calls; hand-declared) ────────────────────────────────

const PROC_ALL_PIDS: u32 = 1;
const PROC_PIDTBSDINFO: c_int = 3;
const PROC_PIDLISTFDS: c_int = 1;
const PROC_PIDPATHINFO_MAXSIZE: usize = 4 * 1024;
const PROC_PIDFDSOCKETINFO: c_int = 3;
const PROX_FDTYPE_SOCKET: u32 = 2;
const SOCKINFO_TCP: c_int = 2;
const TSI_S_LISTEN: c_int = 1;

/// `struct proc_bsdinfo` — 136 bytes. We only need ppid + name fields.
#[repr(C)]
struct ProcBsdInfo {
    pbi_flags: u32,
    pbi_status: u32,
    pbi_xstatus: u32,
    pbi_pid: u32,
    pbi_ppid: u32,
    pbi_uid: u32,
    pbi_gid: u32,
    pbi_ruid: u32,
    pbi_rgid: u32,
    pbi_svuid: u32,
    pbi_svgid: u32,
    rfu_1: u32,
    pbi_comm: [u8; 16],
    pbi_name: [u8; 32],
    pbi_nfiles: u32,
    pbi_pgid: u32,
    pbi_pjobc: u32,
    e_tdev: u32,
    e_tpgid: u32,
    pbi_nice: i32,
    pbi_start_tvsec: u64,
    pbi_start_tvusec: u64,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct ProcFdInfo {
    proc_fd: i32,
    proc_fdtype: u32,
}

/// `struct in4in6_addr` — i46a_addr4 at offset 12.
#[repr(C)]
#[derive(Clone, Copy)]
struct In4In6Addr {
    i46a_pad32: [u32; 3],
    i46a_addr4: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
union InSockAddr {
    ina_46: In4In6Addr,
    ina_6: [u8; 16],
}

/// `struct in_sockinfo` — 80 bytes. lport@4, vflag@24, laddr@48.
#[repr(C)]
#[derive(Clone, Copy)]
struct InSockInfo {
    insi_fport: c_int,
    insi_lport: c_int,
    insi_gencnt: u64,
    insi_flags: u32,
    insi_flow: u32,
    insi_vflag: u8,
    insi_ip_ttl: u8,
    _pad: u16,
    rfu_1: u32,
    insi_faddr: InSockAddr,
    insi_laddr: InSockAddr,
    // v4/v6 extras to reach 80 bytes
    _tail: [u8; 16],
}

/// `struct tcp_sockinfo` — 120 bytes. state@80.
#[repr(C)]
#[derive(Clone, Copy)]
struct TcpSockInfo {
    tcpsi_ini: InSockInfo,
    tcpsi_state: c_int,
    _rest: [u8; 36],
}

#[repr(C)]
#[derive(Clone, Copy)]
union SocketInfoProto {
    pri_tcp: TcpSockInfo,
    _pad: [u8; 528], // socket_info is 768; proto starts at 240 → 528
}

/// `struct socket_info` — 768 bytes. family@160, kind@232, proto@240.
#[repr(C)]
#[derive(Clone, Copy)]
struct SocketInfo {
    _soi_stat: [u8; 136], // vinfo_stat
    _soi_so: u64,
    _soi_pcb: u64,
    _soi_type: c_int,
    _soi_protocol: c_int,
    soi_family: c_int,
    _soi_options: i16,
    _soi_linger: i16,
    _soi_state: i16,
    _soi_qlen: i16,
    _soi_incqlen: i16,
    _soi_qlimit: i16,
    _soi_timeo: i16,
    _soi_error: u16,
    _soi_oobmark: u32,
    _soi_rcv: [u8; 24], // sockbuf_info
    _soi_snd: [u8; 24],
    soi_kind: c_int,
    _rfu_1: u32,
    soi_proto: SocketInfoProto,
}

/// `struct socket_fdinfo` — 792 bytes. pfi(24) + psi(768).
#[repr(C)]
#[derive(Clone, Copy)]
struct SocketFdInfo {
    _pfi: [u8; 24],
    psi: SocketInfo,
}

const _: () = assert!(mem::size_of::<ProcFdInfo>() == 8);
const _: () = assert!(mem::size_of::<InSockInfo>() == 80);
const _: () = assert!(mem::size_of::<TcpSockInfo>() == 120);
const _: () = assert!(mem::size_of::<SocketInfo>() == 768);
const _: () = assert!(mem::size_of::<SocketFdInfo>() == 792);
const _: () = assert!(mem::size_of::<ProcBsdInfo>() == 136);

extern "C" {
    fn proc_listpids(type_: u32, typeinfo: u32, buffer: *mut c_void, buffersize: c_int) -> c_int;
    fn proc_pidinfo(
        pid: c_int,
        flavor: c_int,
        arg: u64,
        buffer: *mut c_void,
        buffersize: c_int,
    ) -> c_int;
    fn proc_pidpath(pid: c_int, buffer: *mut c_void, buffersize: u32) -> c_int;
    fn proc_pidfdinfo(
        pid: c_int,
        fd: c_int,
        flavor: c_int,
        buffer: *mut c_void,
        buffersize: c_int,
    ) -> c_int;
}

// ── snapshot ────────────────────────────────────────────────────────────

pub fn snapshot(scope: &Scope, want_procs: bool, want_ports: bool) -> Snapshot {
    let mut snap = Snapshot::new();
    let all = match list_pids() {
        Ok(p) => p,
        Err(_) => return snap,
    };

    let wanted: Option<HashSet<u32>> = match scope {
        Scope::Host => None,
        Scope::Pids(list) => {
            let have: HashSet<u32> = all.iter().copied().collect();
            for &pid in list {
                if !have.contains(&pid) {
                    snap.unreadable.push(Unreadable {
                        pid,
                        errno: errno_name(libc::ESRCH),
                    });
                }
            }
            Some(list.iter().copied().collect())
        }
        Scope::Roots(roots) => Some(subtree(roots, &all, &mut snap)),
    };

    let mut rows = Vec::new();
    for pid in all {
        if wanted.as_ref().is_some_and(|s| !s.contains(&pid)) {
            continue;
        }
        match read_bsd(pid) {
            Ok((ppid, name)) => {
                if want_procs {
                    rows.push((pid, ppid, name));
                }
                if want_ports {
                    // FD-table denial (launchd / other-uid) is the darwin half
                    // of the U-row contract — not "zero listeners". Collapsing
                    // EPERM to an empty L list made pid-1 look like a clean
                    // empty subtree and broke port-scan's blind throw.
                    match listeners_of(pid) {
                        Ok(ports) => snap.ports.extend(ports),
                        Err(err) => {
                            if !snap.unreadable.iter().any(|u| u.pid == pid) {
                                snap.unreadable.push(Unreadable {
                                    pid,
                                    errno: errno_name(err),
                                });
                            }
                        }
                    }
                }
            }
            Err(err) => {
                // One U per pid — a second failure on the same pid (e.g. list
                // race) must not double-report.
                if !snap.unreadable.iter().any(|u| u.pid == pid) {
                    snap.unreadable.push(Unreadable {
                        pid,
                        errno: errno_name(err),
                    });
                }
            }
        }
    }

    if want_procs {
        rows.sort_by_key(|(pid, _, _)| *pid);
        for (pid, ppid, name) in rows {
            snap.procs.push(Proc { pid, ppid, name });
        }
    }
    if want_ports {
        snap.ports.sort_by_key(|p| (p.pid, p.port));
    }
    snap
}

fn subtree(roots: &[u32], all: &[u32], snap: &mut Snapshot) -> HashSet<u32> {
    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
    let mut readable = HashSet::new();
    for &pid in all {
        if let Ok((ppid, _)) = read_bsd(pid) {
            children.entry(ppid).or_default().push(pid);
            readable.insert(pid);
        }
    }
    let mut out = HashSet::new();
    let mut queue = Vec::new();
    for &r in roots {
        if !readable.contains(&r) {
            snap.unreadable.push(Unreadable {
                pid: r,
                errno: errno_name(libc::ESRCH),
            });
            continue;
        }
        if out.insert(r) {
            queue.push(r);
        }
    }
    while let Some(pid) = queue.pop() {
        if let Some(kids) = children.get(&pid) {
            for &c in kids {
                if out.insert(c) {
                    queue.push(c);
                }
            }
        }
    }
    out
}

fn list_pids() -> Result<Vec<u32>, i32> {
    unsafe {
        let bytes = proc_listpids(PROC_ALL_PIDS, 0, std::ptr::null_mut(), 0);
        if bytes <= 0 {
            return Err(errno());
        }
        let size = bytes + 64 * mem::size_of::<c_int>() as c_int;
        let mut buf = vec![0i32; (size as usize) / mem::size_of::<c_int>()];
        let used = proc_listpids(PROC_ALL_PIDS, 0, buf.as_mut_ptr().cast(), size);
        if used <= 0 {
            return Err(errno());
        }
        let n = (used as usize) / mem::size_of::<c_int>();
        Ok(buf[..n]
            .iter()
            .copied()
            .filter(|&p| p > 0)
            .map(|p| p as u32)
            .collect())
    }
}

fn read_bsd(pid: u32) -> Result<(u32, String), i32> {
    unsafe {
        let mut bsd = mem::zeroed::<ProcBsdInfo>();
        let n = proc_pidinfo(
            pid as c_int,
            PROC_PIDTBSDINFO,
            0,
            (&raw mut bsd).cast(),
            mem::size_of::<ProcBsdInfo>() as c_int,
        );
        if n < mem::size_of::<ProcBsdInfo>() as c_int {
            return Err(errno());
        }
        let name = path_basename(pid)
            .or_else(|| cstr_field(&bsd.pbi_name))
            .or_else(|| cstr_field(&bsd.pbi_comm))
            .unwrap_or_else(|| pid.to_string());
        Ok((bsd.pbi_ppid, sanitize_name(&name)))
    }
}

fn path_basename(pid: u32) -> Option<String> {
    unsafe {
        let mut buf = [0u8; PROC_PIDPATHINFO_MAXSIZE];
        let n = proc_pidpath(pid as c_int, buf.as_mut_ptr().cast(), buf.len() as u32);
        if n <= 0 {
            return None;
        }
        let path = CStr::from_ptr(buf.as_ptr().cast()).to_string_lossy();
        Path::new(path.as_ref())
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
    }
}

fn cstr_field(buf: &[u8]) -> Option<String> {
    let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
    if end == 0 {
        None
    } else {
        Some(String::from_utf8_lossy(&buf[..end]).into_owned())
    }
}

/// List TCP LISTEN sockets for `pid`. Err is a real probe failure (EPERM on
/// launchd's fd table for a normal-uid caller); Ok(empty) is "readable, none".
fn listeners_of(pid: u32) -> Result<Vec<Port>, i32> {
    unsafe {
        // Clear stale errno so a 0-byte success is not confused with EPERM.
        *libc::__error() = 0;
        let size = proc_pidinfo(pid as c_int, PROC_PIDLISTFDS, 0, std::ptr::null_mut(), 0);
        if size <= 0 {
            let e = errno();
            return if e != 0 { Err(e) } else { Ok(Vec::new()) };
        }
        let size = size + 32 * mem::size_of::<ProcFdInfo>() as c_int;
        let mut fds =
            vec![mem::zeroed::<ProcFdInfo>(); (size as usize) / mem::size_of::<ProcFdInfo>()];
        *libc::__error() = 0;
        let used = proc_pidinfo(
            pid as c_int,
            PROC_PIDLISTFDS,
            0,
            fds.as_mut_ptr().cast(),
            size,
        );
        if used <= 0 {
            let e = errno();
            return if e != 0 { Err(e) } else { Ok(Vec::new()) };
        }
        let n = (used as usize) / mem::size_of::<ProcFdInfo>();
        let mut out = Vec::new();
        for fd in &fds[..n] {
            if fd.proc_fdtype != PROX_FDTYPE_SOCKET {
                continue;
            }
            let mut si = mem::zeroed::<SocketFdInfo>();
            let got = proc_pidfdinfo(
                pid as c_int,
                fd.proc_fd,
                PROC_PIDFDSOCKETINFO,
                (&raw mut si).cast(),
                mem::size_of::<SocketFdInfo>() as c_int,
            );
            if got < mem::size_of::<SocketFdInfo>() as c_int {
                continue;
            }
            if si.psi.soi_kind != SOCKINFO_TCP {
                continue;
            }
            let tcp = si.psi.soi_proto.pri_tcp;
            if tcp.tcpsi_state != TSI_S_LISTEN {
                continue;
            }
            let ini = tcp.tcpsi_ini;
            // insi_lport is network byte order (same as sockaddr).
            let port = u16::from_be(ini.insi_lport as u16);
            if port == 0 {
                continue;
            }
            let addr = match slot_from_vflag(si.psi.soi_family, ini.insi_vflag) {
                AddressSlot::V4 => {
                    // s_addr is stored in network order; emit the in-memory
                    // bytes (same as portScanDarwin.c's byte walk).
                    let s = ini.insi_laddr.ina_46.i46a_addr4;
                    s.to_ne_bytes().to_vec()
                }
                AddressSlot::V6 => ini.insi_laddr.ina_6.to_vec(),
            };
            out.push(Port {
                pid,
                port,
                address: hex_bytes(&addr),
            });
        }
        Ok(out)
    }
}

fn errno() -> i32 {
    unsafe { *libc::__error() }
}
