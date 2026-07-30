//! Pure decoders for the two shapes a unix socket's name arrives in — no OS,
//! no I/O.
//!
//! Linux publishes a world-readable table of every bound unix socket and
//! darwin publishes none, so the two holder readers stand on different
//! sources: a text table row on one, a kernel `sockaddr_un` slot on the other.
//! Both parses are subtle for the same reason — a socket path is an arbitrary
//! byte string with no quoting and no guarantee of being UTF-8 — so both live
//! here, pinned by unit tests on every platform rather than only the one that
//! can read the source.

/// `AF_UNIX`, which is 1 on both platforms this binary supports. Spelled as a
/// constant rather than read from `libc` because this decoder is compiled (and
/// its tests run) on the platform that does NOT produce these bytes; the
/// assertion below is what keeps the two spellings honest wherever it builds.
const AF_UNIX_FAMILY: u8 = 1;
const _: () = assert!(AF_UNIX_FAMILY as i32 == libc::AF_UNIX);

/// `sizeof ((struct sockaddr_un *)0)->sun_path` from `<sys/un.h>`.
pub const SUN_PATH_LEN: usize = 104;

/// The inodes of every table row whose PATH is exactly `path`, in first-seen
/// order and without repeats.
///
/// The rules the row shape forces:
///
/// - **Seven fixed fields, then the path verbatim.** `Num RefCount Protocol
///   Flags Type St Inode` are whitespace-delimited; everything after the
///   seventh is the path. A `split_whitespace().nth(7)` truncates
///   `/tmp/my state/pty-host.sock` at the space, and a `trim()` corrupts a
///   path that legitimately ends in one.
/// - **A row with no eighth field is skipped** — a connected peer with no
///   bound name, and the header line, both land here.
/// - **Exact bytes, no canonicalization.** The kernel bound the bytes the
///   daemon passed to `bind(2)`; resolving symlinks or normalizing `..` would
///   answer about a different socket than the caller asked about.
/// - **Inode 0 is not a socket identity** — it is what the table prints for a
///   row whose inode it will not disclose, and attributing fds to it would
///   claim every such row at once.
pub fn unix_socket_inodes(table: &str, path: &[u8]) -> Vec<u64> {
    let mut out = Vec::new();
    for line in table.lines() {
        let Some((inode, row_path)) = split_unix_row(line) else {
            continue;
        };
        if row_path.as_bytes() == path && !out.contains(&inode) {
            out.push(inode);
        }
    }
    out
}

/// One table row → `(inode, path)`, or `None` for a row that carries neither
/// (the header, a peer with no bound name, an undisclosed inode).
fn split_unix_row(line: &str) -> Option<(u64, &str)> {
    const FIXED_FIELDS: usize = 7;
    const INODE_FIELD: usize = 6;

    let mut rest = line.trim_start();
    let mut inode = None;
    for field in 0..FIXED_FIELDS {
        let end = rest.find([' ', '\t'])?;
        if field == INODE_FIELD {
            inode = rest[..end].parse::<u64>().ok();
        }
        rest = rest[end..].trim_start_matches([' ', '\t']);
    }
    match (inode, rest) {
        (Some(inode), path) if inode > 0 && !path.is_empty() => Some((inode, path)),
        _ => None,
    }
}

/// The `sun_path` bytes of a darwin `un_sockinfo` address slot, or `None` when
/// the slot names no AF_UNIX pathname.
///
/// The slot is a union: `struct sockaddr_un { u8 sun_len; u8 sun_family; char
/// sun_path[104]; }` overlaid on `SOCK_MAXADDRLEN` bytes of whatever address
/// family the socket actually has. So the family byte decides whether there is
/// a path here at all — reading `sun_path` without it would hand back another
/// family's address bytes as if they were a filesystem name.
///
/// `sun_len` is deliberately NOT trusted as the length: the kernel fills these
/// records for sockets bound by anyone, and a NUL scan over the fixed field is
/// the same rule the path was written with. An empty path (an unbound socket,
/// or darwin's empty spelling for an unnamed one) is `None`, not `Some("")` —
/// no caller can hold a socket at the empty path, so it is an absence.
pub fn sockaddr_un_path(slot: &[u8]) -> Option<&[u8]> {
    if slot.len() < 2 + SUN_PATH_LEN || slot[1] != AF_UNIX_FAMILY {
        return None;
    }
    let path = &slot[2..2 + SUN_PATH_LEN];
    let end = path.iter().position(|&b| b == 0).unwrap_or(SUN_PATH_LEN);
    (end > 0).then(|| &path[..end])
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A `SOCK_MAXADDRLEN` slot carrying `family` and `path`, as the kernel
    /// fills one.
    fn slot(family: u8, path: &[u8]) -> [u8; 255] {
        let mut out = [0u8; 255];
        out[0] = (2 + path.len() + 1) as u8; // sun_len, which we never read
        out[1] = family;
        out[2..2 + path.len()].copy_from_slice(path);
        out
    }

    #[test]
    fn a_bound_slot_yields_its_path() {
        assert_eq!(
            sockaddr_un_path(&slot(AF_UNIX_FAMILY, b"/run/user/501/kaval.sock")),
            Some(&b"/run/user/501/kaval.sock"[..])
        );
    }

    /// The union's other arms are addresses, not names. Reading `sun_path`
    /// off an AF_INET record would report raw address bytes as a socket path.
    #[test]
    fn a_slot_of_another_family_names_nothing() {
        assert_eq!(sockaddr_un_path(&slot(2 /* AF_INET */, b"/not/a/path")), None);
    }

    /// An unnamed socket is an absence, not a holder of the empty path.
    #[test]
    fn an_empty_path_is_an_absence() {
        assert_eq!(sockaddr_un_path(&slot(AF_UNIX_FAMILY, b"")), None);
    }

    /// A path that fills `sun_path` exactly has no NUL to stop at.
    #[test]
    fn a_path_that_fills_the_field_is_read_whole() {
        let full = vec![b'x'; SUN_PATH_LEN];

        assert_eq!(
            sockaddr_un_path(&slot(AF_UNIX_FAMILY, &full)),
            Some(&full[..])
        );
    }

    /// A short buffer is not a short path — refusing it is what keeps the
    /// decoder from reading past a record the kernel truncated.
    #[test]
    fn a_slot_too_short_to_hold_sun_path_is_refused() {
        let short = slot(AF_UNIX_FAMILY, b"/run/a.sock");

        assert_eq!(sockaddr_un_path(&short[..2 + SUN_PATH_LEN - 1]), None);
    }

    /// The real column layout, as the kernel prints it.
    const TABLE: &str = "\
Num       RefCount Protocol Flags    Type St Inode Path
ffff9a0000000000: 00000002 00000000 00010000 0001 01 41231 /run/user/1000/padi.sock
ffff9a0000000001: 00000003 00000000 00000000 0001 03 41232
ffff9a0000000002: 00000002 00000000 00010000 0001 01 41233 /tmp/my state/pty-host.sock
ffff9a0000000003: 00000002 00000000 00010000 0001 01 41234 /tmp/trailing \n";

    #[test]
    fn a_bound_path_resolves_to_its_inode() {
        assert_eq!(
            unix_socket_inodes(TABLE, b"/run/user/1000/padi.sock"),
            vec![41231]
        );
    }

    /// The defect a `split_whitespace().nth(7)` ships: the path is truncated
    /// at its first space, so the socket looks unbound and a supervisor spawns
    /// a second daemon onto a live rendezvous.
    #[test]
    fn a_path_containing_a_space_is_matched_whole() {
        assert_eq!(
            unix_socket_inodes(TABLE, b"/tmp/my state/pty-host.sock"),
            vec![41233]
        );
        assert!(unix_socket_inodes(TABLE, b"/tmp/my").is_empty());
    }

    /// The mirror defect a `trim()` ships. A trailing space is part of the
    /// name the kernel bound.
    #[test]
    fn a_path_ending_in_a_space_keeps_it() {
        assert_eq!(unix_socket_inodes(TABLE, b"/tmp/trailing "), vec![41234]);
        assert!(unix_socket_inodes(TABLE, b"/tmp/trailing").is_empty());
    }

    #[test]
    fn a_row_with_no_path_and_the_header_are_skipped() {
        // Every inode this table discloses belongs to a row WITH a path, so no
        // query can ever resolve to the path-less peer's 41232.
        for path in ["", "Path", "41232"] {
            assert!(
                unix_socket_inodes(TABLE, path.as_bytes()).is_empty(),
                "{path:?} must not match a row"
            );
        }
    }

    /// Inode 0 is the table's "not disclosed" marker. Matching it would
    /// attribute every fd whose inode we equally cannot read.
    #[test]
    fn an_undisclosed_inode_is_not_a_socket_identity() {
        let table = "ffff: 00000002 00000000 00010000 0001 01 0 /run/gated.sock\n";

        assert!(unix_socket_inodes(table, b"/run/gated.sock").is_empty());
    }

    /// `SO_REUSEPORT`-style duplication and a moving row can both put the same
    /// path on several inodes; each is a distinct socket to attribute, but one
    /// inode listed twice is one socket.
    #[test]
    fn one_path_can_carry_several_distinct_inodes_but_no_repeats() {
        let table = "\
ffff: 00000002 00000000 00010000 0001 01 10 /run/a.sock
ffff: 00000002 00000000 00010000 0001 01 11 /run/a.sock
ffff: 00000002 00000000 00010000 0001 01 10 /run/a.sock\n";

        assert_eq!(unix_socket_inodes(table, b"/run/a.sock"), vec![10, 11]);
    }
}
