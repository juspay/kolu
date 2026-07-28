//! The darwin host-wide listener table — pure decode and pure merge.
//!
//! `net.inet.tcp.pcblist_n` is read by `darwin`, but *interpreting* its bytes
//! and merging the result with the same-uid fd walk touch no OS at all. They
//! live here so they are compiled and tested on every platform, not only on
//! the darwin CI lane — which matters more here than anywhere else in the
//! crate, because Apple's table layout is the one volatility this tool has
//! already watched move.

use crate::schema::{hex_bytes, Attribution, Port};
use std::collections::HashMap;

const XSO_INPCB: u32 = 0x010;
const XSO_TCPCB: u32 = 0x020;
const INP_IPV6: u8 = 0x2;

/// The TCP state a listening socket reports — in the `xtcpcb_n` record here,
/// and in `tcpsi_state` from the libproc fd walk.
pub const TCP_STATE_LISTEN: i32 = 1;

// Apple XNU declares `xinpcb_n` under `#pragma pack(4)`. Keep these offsets
// beside the decoder: lport follows xi_inpp + fport, while vflag and the local
// 16-byte address follow the generation/flags/flow prefix. The corresponding
// `xtcpcb_n` state follows t_segq, dupacks, and four timers.
const XINPCB_LPORT_OFFSET: usize = 18;
const XINPCB_VFLAG_OFFSET: usize = 44;
const XINPCB_LADDR_OFFSET: usize = 64;
const XTCPCB_STATE_OFFSET: usize = 36;

/// Apple frames a `pcblist_n` with an opening header and a trailing record of
/// exactly this size. Anything shorter is malformed, not a terminator.
const CLOSING_RECORD_LEN: usize = 24;

/// One listener as the host-wide table reports it: a port and a hex bind
/// address. No uid — `xinpcb_n` does not carry one.
pub type HostListener = (u16, String);

/// Walk the record stream and return every listening socket.
///
/// Fails loudly on a record it cannot frame. Returning the rows read so far
/// would hand the caller a silently SHORT listener set that looks perfectly
/// healthy — no `E` row, no `U` row — from exactly the source whose layout
/// Apple has already changed once.
pub fn decode_host_listeners(bytes: &[u8]) -> Result<Vec<HostListener>, i32> {
    if bytes.len() < 4 {
        return Ok(Vec::new());
    }
    let header_len = read_u32(bytes, 0)? as usize;
    // The kernel supplies every length in this buffer, so each one is checked
    // against the buffer before it is trusted, and every cursor step is
    // checked arithmetic. An unchecked `offset + len` wraps in release, and a
    // wrapped sum passes a `> bytes.len()` bound — admitting a phantom record
    // read from fixed offsets. A header that overshoots the buffer is drift
    // too, and must not leave the loop unentered and report `Ok(empty)`, which
    // the caller reads as a gated-but-healthy table.
    let mut offset = round_up_8(header_len).ok_or(libc::EINVAL)?;
    if offset > bytes.len() {
        return Err(libc::EINVAL);
    }
    let mut pending: Option<HostListener> = None;
    let mut out = Vec::new();
    while offset + 8 <= bytes.len() {
        let len = read_u32(bytes, offset)? as usize;
        let end = offset.checked_add(len).ok_or(libc::EINVAL)?;
        if len < CLOSING_RECORD_LEN || end > bytes.len() {
            return Err(libc::EINVAL);
        }
        // A bare 24-byte record is the table's closing marker. Both committed
        // captures end with one — it is how the 48-byte ad-hoc capture
        // (opening header + closing record, no sockets) reaches
        // `BLIND_OR_EMPTY` rather than an error.
        if len == CLOSING_RECORD_LEN {
            break;
        }
        let kind = read_u32(bytes, offset + 4)?;
        if kind == XSO_INPCB && len >= 84 {
            let raw_port = u16::from_ne_bytes(
                bytes[offset + XINPCB_LPORT_OFFSET..offset + XINPCB_LPORT_OFFSET + 2]
                    .try_into()
                    .expect("two bytes"),
            );
            let port = u16::from_be(raw_port);
            let vflag = bytes[offset + XINPCB_VFLAG_OFFSET];
            let local = &bytes[offset + XINPCB_LADDR_OFFSET..offset + XINPCB_LADDR_OFFSET + 16];
            let address = if vflag & INP_IPV6 != 0 {
                hex_bytes(local)
            } else {
                hex_bytes(&local[12..16])
            };
            pending = Some((port, address));
        } else if kind == XSO_TCPCB && len >= 40 {
            let state = i32::from_ne_bytes(
                bytes[offset + XTCPCB_STATE_OFFSET..offset + XTCPCB_STATE_OFFSET + 4]
                    .try_into()
                    .expect("four bytes"),
            );
            if state == TCP_STATE_LISTEN {
                if let Some(row) = pending.take() {
                    if row.0 != 0 {
                        out.push(row);
                    }
                }
            } else {
                pending = None;
            }
        }
        offset = round_up_8(end).ok_or(libc::EINVAL)?;
    }
    Ok(out)
}

/// Merge the host-wide table with the same-uid fd walk.
///
/// **Always a union.** A listener the fd walk positively observed is a fact
/// this tool is holding; a host table that omits it must not delete it. The
/// previous shape switched truth sources on a mode flag — host table if
/// non-empty, claims otherwise — so a *partially* gated table (the next shape
/// of the macOS-version axis, given Apple already gates it wholly) silently
/// dropped claimed listeners with neither a `U` nor an `E` row.
///
/// Whether the host table went blind is the caller's single decision, made
/// once from `rows.is_empty()` before calling this. This function does not
/// re-derive it.
pub fn attribute_host_listeners(
    mut rows: Vec<HostListener>,
    claims: &HashMap<HostListener, Vec<u32>>,
) -> Vec<Port> {
    for key in claims.keys() {
        if !rows.contains(key) {
            rows.push(key.clone());
        }
    }
    rows.sort();
    rows.into_iter()
        .map(|(port, address)| Port {
            attribution: claims
                .get(&(port, address.clone()))
                .and_then(|pids| pids.first())
                .map_or(Attribution::Unclaimed, |&pid| Attribution::Claimed { pid }),
            // Neither darwin listener source carries the socket's owning uid.
            // `darwin::snapshot` reports that absence as `E … ports_uid`
            // rather than leaving a consumer to infer it from its own platform.
            uid: None,
            port,
            address,
        })
        .collect()
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, i32> {
    let end = offset.checked_add(4).ok_or(libc::EINVAL)?;
    bytes
        .get(offset..end)
        .and_then(|slice| slice.try_into().ok())
        .map(u32::from_ne_bytes)
        .ok_or(libc::EINVAL)
}

/// Round to the next 8-byte boundary, or `None` if that would overflow.
///
/// Saturating here would be a lie: it turns an impossible length into
/// `usize::MAX`, which then compares as "past the buffer" by luck rather than
/// by check. A kernel length that cannot be rounded is drift, and drift is an
/// error.
fn round_up_8(value: usize) -> Option<usize> {
    value.checked_add(7).map(|v| v & !7)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PLATFORM: &[u8] = include_bytes!("../tests/fixtures/darwin/macos27-pcblist-platform.bin");
    const ADHOC: &[u8] = include_bytes!("../tests/fixtures/darwin/macos27-pcblist-adhoc.bin");

    #[test]
    fn macos_27_platform_pcblist_decodes_every_netstat_listener() {
        let rows = decode_host_listeners(PLATFORM).expect("decode platform-signed capture");

        assert_eq!(PLATFORM.len(), 54_872);
        assert_eq!(rows.len(), 29);
        assert!(rows
            .iter()
            .all(|(port, address)| *port != 0 && !address.is_empty()));
    }

    #[test]
    fn macos_27_adhoc_pcblist_is_the_detectable_empty_shape() {
        let rows = decode_host_listeners(ADHOC).expect("decode ad-hoc capture");

        assert_eq!(ADHOC.len(), 48);
        assert!(
            rows.is_empty(),
            "the empty table must reach BLIND_OR_EMPTY detection"
        );
    }

    #[test]
    fn a_truncated_pcblist_record_is_loud_blindness_not_a_short_table() {
        // Cut mid-record: the walker meets a length that runs past the buffer.
        assert_eq!(
            decode_host_listeners(&PLATFORM[..20_000]),
            Err(libc::EINVAL)
        );
        // Losing only the closing record is the same class of drift.
        assert_eq!(
            decode_host_listeners(&PLATFORM[..PLATFORM.len() - 1]),
            Err(libc::EINVAL)
        );
    }

    #[test]
    fn a_header_that_overshoots_the_buffer_is_loud_drift_not_an_empty_table() {
        // A corrupt opening length used to push the cursor past the end, so
        // the record loop never ran and the walk returned `Ok(empty)` — which
        // the caller reports as BLIND_OR_EMPTY, a gated-but-healthy table.
        let mut bytes = PLATFORM.to_vec();
        bytes[..4].copy_from_slice(&u32::to_ne_bytes(0xffff_0000));

        assert_eq!(decode_host_listeners(&bytes), Err(libc::EINVAL));
    }

    #[test]
    fn an_enormous_record_length_is_loud_drift() {
        // The cursor arithmetic is checked rather than wrapping. On a 64-bit
        // usize a u32 length cannot actually wrap `offset + len`, so this pins
        // the reachable half — a length past the buffer is an error, never a
        // phantom record read from fixed offsets — while `checked_add` keeps
        // the unreachable half unspellable rather than true by luck.
        let header_len = u32::from_ne_bytes(PLATFORM[..4].try_into().expect("four bytes")) as usize;
        let first = round_up_8(header_len).expect("fixture header rounds");
        let mut bytes = PLATFORM.to_vec();
        bytes[first..first + 4].copy_from_slice(&u32::to_ne_bytes(u32::MAX));

        assert_eq!(decode_host_listeners(&bytes), Err(libc::EINVAL));
    }

    #[test]
    fn macos_27_gate_keeps_same_uid_fd_claims() {
        let host_rows = decode_host_listeners(ADHOC).expect("decode ad-hoc capture");
        let claims = HashMap::from([((54314, "7f000001".to_owned()), vec![4242])]);

        let rows = attribute_host_listeners(host_rows, &claims);

        assert_eq!(rows.len(), 1);
        assert!(matches!(
            rows[0].attribution,
            Attribution::Claimed { pid: 4242 }
        ));
        assert_eq!(rows[0].port, 54314);
        assert_eq!(rows[0].address, "7f000001");
    }

    #[test]
    fn a_partially_gated_host_table_cannot_delete_an_observed_claim() {
        let host_rows = decode_host_listeners(PLATFORM).expect("decode platform-signed capture");
        let claimed = (54314, "7f000001".to_owned());
        assert!(
            !host_rows.contains(&claimed),
            "fixture must not already list it"
        );
        let claims = HashMap::from([(claimed, vec![4242])]);

        let rows = attribute_host_listeners(host_rows, &claims);

        assert_eq!(rows.len(), 30, "the union keeps every listener");
        let ours = rows
            .iter()
            .find(|row| row.port == 54314 && row.address == "7f000001")
            .expect("the fd walk observed this listener; the union must keep it");
        assert!(matches!(
            ours.attribution,
            Attribution::Claimed { pid: 4242 }
        ));
    }
}
