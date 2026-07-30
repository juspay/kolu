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

/// DARWIN's `sizeof ((struct sockaddr_un *)0)->sun_path` from `<sys/un.h>`.
///
/// The number is platform-specific — linux's is 108 — and this decoder is only
/// ever fed darwin `un_sockinfo` slots, which is why it is spelled here rather
/// than read from `libc` on a host that would report the other one. It is
/// PRIVATE, and its name says whose it is, for exactly that reason: a `pub`
/// `DARWIN_SUN_PATH_LEN` reads as a portable fact, and a linux-sourced slot fed
/// through it would be silently sliced at the wrong window. (`AF_UNIX_FAMILY`
/// above can afford a `const _: () = assert!(…)` guard because it IS the same
/// on both; this one cannot have one, which is the whole hazard.)
const DARWIN_SUN_PATH_LEN: usize = 104;

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
/// - **BYTES, not text.** The table is host-wide, and a socket path is whatever
///   bytes some process handed `bind(2)` — any unprivileged process on the box
///   can bind a name that is not valid UTF-8. Decoding the whole file as a
///   `String` therefore lets one such process fail the read outright and blind
///   this verb for *every* path on the host. A row this parser cannot make
///   sense of costs that row alone.
/// - **One delimiter before the path, not a run.** The byte after the inode
///   column ends the column; every byte after THAT is the name. Skipping a
///   whitespace *run* there eats the leading space of a path that begins with
///   one, and a socket whose name starts with a space then reads as unheld —
///   the affirmative answer, manufactured out of a parse rule.
///
/// `Err` when the document is not a `/proc/net/unix` table at all: an empty
/// read, a truncated one, a kernel whose format drifted. That distinction is
/// the whole point — "no row matched a real table" is proof of absence, while
/// "this is not a table" is blindness, and a decoder that returned an empty
/// vec for both would hand the caller the dangerous one.
pub fn unix_socket_inodes(table: &[u8], path: &[u8]) -> Result<Vec<u64>, ()> {
    let mut lines = table.split(|&b| b == b'\n');
    // The kernel's own header, in full and in order — the only evidence
    // available that what was read IS this table, and therefore the only thing
    // that may authorize `Ok(empty)`, which linux promotes to proof of absence.
    // A substring search for one token is NOT that evidence: `garbage Inode
    // garbage` would pass it, parse to no rows, and hand back the affirmative
    // answer. `parse_proc_net` applies the same header rule to `/proc/net/tcp`.
    if !lines.next().is_some_and(is_unix_table_header) {
        return Err(());
    }
    let mut out = Vec::new();
    for line in lines {
        let Some((inode, row_path)) = split_unix_row(line) else {
            continue;
        };
        if row_path == path && !out.contains(&inode) {
            out.push(inode);
        }
    }
    Ok(out)
}

/// The column names `/proc/net/unix` prints, in order. Matched whole so a
/// document that merely mentions one of them cannot pose as the table.
const UNIX_TABLE_COLUMNS: [&[u8]; 8] = [
    b"Num", b"RefCount", b"Protocol", b"Flags", b"Type", b"St", b"Inode", b"Path",
];

fn is_unix_table_header(header: &[u8]) -> bool {
    let mut columns = header
        .split(|&b| b == b' ' || b == b'\t' || b == b'\r')
        .filter(|field| !field.is_empty());
    UNIX_TABLE_COLUMNS
        .iter()
        .all(|want| columns.next() == Some(want))
        && columns.next().is_none()
}

/// One table row → `(inode, path)`, or `None` for a row that carries neither
/// (a peer with no bound name, an undisclosed inode).
fn split_unix_row(line: &[u8]) -> Option<(u64, &[u8])> {
    const FIXED_FIELDS: usize = 7;
    const INODE_FIELD: usize = 6;
    let is_space = |b: u8| b == b' ' || b == b'\t';

    // Nothing is trimmed off the END of the line: `/proc/net/unix` is
    // LF-framed, so a trailing `\r` — like a trailing space — is a byte of the
    // name the kernel really bound, not framing to strip.
    let mut rest = &line[line.iter().position(|&b| !is_space(b))?..];
    let mut inode = None;
    for field in 0..FIXED_FIELDS {
        let end = rest.iter().position(|&b| is_space(b))?;
        if field == INODE_FIELD {
            // Only the inode column is ever decoded, and only as ASCII digits.
            inode = std::str::from_utf8(&rest[..end])
                .ok()
                .and_then(|digits| digits.parse::<u64>().ok());
            // Exactly ONE delimiter, then the name verbatim — see the header.
            rest = rest.get(end + 1..)?;
            break;
        }
        rest = &rest[end..];
        rest = &rest[rest.iter().position(|&b| !is_space(b))?..];
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
pub fn darwin_sockaddr_un_path(slot: &[u8]) -> Option<&[u8]> {
    if slot.len() < 2 + DARWIN_SUN_PATH_LEN || slot[1] != AF_UNIX_FAMILY {
        return None;
    }
    let path = &slot[2..2 + DARWIN_SUN_PATH_LEN];
    let end = path.iter().position(|&b| b == 0).unwrap_or(DARWIN_SUN_PATH_LEN);
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
            darwin_sockaddr_un_path(&slot(AF_UNIX_FAMILY, b"/run/user/501/kaval.sock")),
            Some(&b"/run/user/501/kaval.sock"[..])
        );
    }

    /// The union's other arms are addresses, not names. Reading `sun_path`
    /// off an AF_INET record would report raw address bytes as a socket path.
    #[test]
    fn a_slot_of_another_family_names_nothing() {
        assert_eq!(darwin_sockaddr_un_path(&slot(2 /* AF_INET */, b"/not/a/path")), None);
    }

    /// An unnamed socket is an absence, not a holder of the empty path.
    #[test]
    fn an_empty_path_is_an_absence() {
        assert_eq!(darwin_sockaddr_un_path(&slot(AF_UNIX_FAMILY, b"")), None);
    }

    /// A path that fills `sun_path` exactly has no NUL to stop at.
    #[test]
    fn a_path_that_fills_the_field_is_read_whole() {
        let full = vec![b'x'; DARWIN_SUN_PATH_LEN];

        assert_eq!(
            darwin_sockaddr_un_path(&slot(AF_UNIX_FAMILY, &full)),
            Some(&full[..])
        );
    }

    /// A short buffer is not a short path — refusing it is what keeps the
    /// decoder from reading past a record the kernel truncated.
    #[test]
    fn a_slot_too_short_to_hold_sun_path_is_refused() {
        let short = slot(AF_UNIX_FAMILY, b"/run/a.sock");

        assert_eq!(darwin_sockaddr_un_path(&short[..2 + DARWIN_SUN_PATH_LEN - 1]), None);
    }

    /// The real column layout, as the kernel prints it.
    const TABLE: &[u8] = b"\
Num       RefCount Protocol Flags    Type St Inode Path
ffff9a0000000000: 00000002 00000000 00010000 0001 01 41231 /run/user/1000/padi.sock
ffff9a0000000001: 00000003 00000000 00000000 0001 03 41232
ffff9a0000000002: 00000002 00000000 00010000 0001 01 41233 /tmp/my state/pty-host.sock
ffff9a0000000003: 00000002 00000000 00010000 0001 01 41234 /tmp/trailing\x20
ffff9a0000000004: 00000002 00000000 00010000 0001 01 41235  /tmp/leading
ffff9a0000000005: 00000002 00000000 00010000 0001 01 41236 /tmp/carriage\r\n";

    /// A body with the kernel's header, for a case that needs its own rows.
    fn table(body: &str) -> Vec<u8> {
        let mut out = Vec::from(&b"Num       RefCount Protocol Flags    Type St Inode Path\n"[..]);
        out.extend_from_slice(body.as_bytes());
        out
    }

    #[test]
    fn a_bound_path_resolves_to_its_inode() {
        assert_eq!(
            unix_socket_inodes(TABLE, b"/run/user/1000/padi.sock").expect("a real table"),
            vec![41231]
        );
    }

    /// The defect a `split_whitespace().nth(7)` ships: the path is truncated
    /// at its first space, so the socket looks unbound and a supervisor spawns
    /// a second daemon onto a live rendezvous.
    #[test]
    fn a_path_containing_a_space_is_matched_whole() {
        assert_eq!(
            unix_socket_inodes(TABLE, b"/tmp/my state/pty-host.sock").expect("a real table"),
            vec![41233]
        );
        assert!(unix_socket_inodes(TABLE, b"/tmp/my").expect("a real table").is_empty());
    }

    /// The mirror defect a `trim()` ships. A trailing space is part of the
    /// name the kernel bound.
    #[test]
    fn a_path_ending_in_a_space_keeps_it() {
        assert_eq!(unix_socket_inodes(TABLE, b"/tmp/trailing ").expect("a real table"), vec![41234]);
        assert!(unix_socket_inodes(TABLE, b"/tmp/trailing").expect("a real table").is_empty());
    }

    /// The byte after the inode column ENDS that column; every byte after it is
    /// the name. Skipping a whitespace RUN there ate the leading space of a
    /// path that begins with one — and a socket whose name starts with a space
    /// then read as unheld, which is the affirmative answer manufactured out of
    /// a parse rule. Reproduced against the shipped binary by the review peer.
    #[test]
    fn a_path_beginning_with_a_space_keeps_it() {
        assert_eq!(
            unix_socket_inodes(TABLE, b" /tmp/leading").expect("a real table"),
            vec![41235]
        );
        assert!(unix_socket_inodes(TABLE, b"/tmp/leading")
            .expect("a real table")
            .is_empty());
    }

    /// The mirror rule at the other end. `/proc/net/unix` is LF-framed, so a
    /// trailing `\r` is a byte of the name, not framing to strip.
    #[test]
    fn a_path_ending_in_a_carriage_return_keeps_it() {
        assert_eq!(
            unix_socket_inodes(TABLE, b"/tmp/carriage\r").expect("a real table"),
            vec![41236]
        );
        assert!(unix_socket_inodes(TABLE, b"/tmp/carriage")
            .expect("a real table")
            .is_empty());
    }

    /// "No row matched a real table" is proof of absence; "this is not a table"
    /// is blindness. A decoder that returned an empty vec for both would hand
    /// linux the dangerous one — an empty read or a drifted kernel format would
    /// become the affirmative *nobody holds it*.
    #[test]
    fn a_document_that_is_not_the_table_is_refused_not_read_as_empty() {
        for not_a_table in [
            &b""[..],
            b"\n",
            b"garbage\n",
            b"Num RefCount Protocol\n",
            // A counterfeit: it MENTIONS the token a substring check looks
            // for, so it would pass one and hand back absence.
            b"garbage Inode garbage\n",
            // The real columns, out of order.
            b"Num RefCount Protocol Flags Type St Path Inode\n",
            // The real columns plus one the kernel does not print.
            b"Num RefCount Protocol Flags Type St Inode Path Extra\n",
        ] {
            assert!(
                unix_socket_inodes(not_a_table, b"/run/a.sock").is_err(),
                "{not_a_table:?} must not read as a table with no matching row"
            );
        }
        // And the real thing, with no matching row, IS absence.
        assert_eq!(
            unix_socket_inodes(TABLE, b"/run/nobody.sock").expect("a real table"),
            Vec::<u64>::new()
        );
    }

    #[test]
    fn a_row_with_no_path_and_the_header_are_skipped() {
        // Every inode this table discloses belongs to a row WITH a path, so no
        // query can ever resolve to the path-less peer's 41232.
        for path in ["", "Path", "41232"] {
            assert!(
                unix_socket_inodes(TABLE, path.as_bytes()).expect("a real table").is_empty(),
                "{path:?} must not match a row"
            );
        }
    }

    /// Inode 0 is the table's "not disclosed" marker. Matching it would
    /// attribute every fd whose inode we equally cannot read.
    #[test]
    fn an_undisclosed_inode_is_not_a_socket_identity() {
        let body = table("ffff: 00000002 00000000 00010000 0001 01 0 /run/gated.sock\n");

        assert!(unix_socket_inodes(&body, b"/run/gated.sock")
            .expect("a real table")
            .is_empty());
    }

    /// The host-wide table names sockets this binary did not create, so one
    /// process binding a non-UTF-8 name must not cost every OTHER row. A
    /// whole-file `String` decode is what made that possible: any unprivileged
    /// process could blind the verb for the entire host by binding one bad byte.
    #[test]
    fn a_non_utf8_row_costs_only_itself() {
        let mut body = table("ffff: 00000002 00000000 00010000 0001 01 10 /run/");
        body.push(0xff); // a byte no UTF-8 decode accepts
        body.extend_from_slice(b".sock\n");
        body.extend_from_slice(b"ffff: 00000002 00000000 00010000 0001 01 11 /run/kaval.sock\n");

        assert_eq!(
            unix_socket_inodes(&body, b"/run/kaval.sock").expect("a real table"),
            vec![11]
        );
        // And the bad row is still matchable, by the bytes it really carries.
        assert_eq!(
            unix_socket_inodes(&body, b"/run/\xff.sock").expect("a real table"),
            vec![10],
            "the row's own bytes must still resolve"
        );
    }

    /// `SO_REUSEPORT`-style duplication and a moving row can both put the same
    /// path on several inodes; each is a distinct socket to attribute, but one
    /// inode listed twice is one socket.
    #[test]
    fn one_path_can_carry_several_distinct_inodes_but_no_repeats() {
        let body = table(
            "ffff: 00000002 00000000 00010000 0001 01 10 /run/a.sock\n\
ffff: 00000002 00000000 00010000 0001 01 11 /run/a.sock\n\
ffff: 00000002 00000000 00010000 0001 01 10 /run/a.sock\n",
        );

        assert_eq!(
            unix_socket_inodes(&body, b"/run/a.sock").expect("a real table"),
            vec![10, 11]
        );
    }
}
