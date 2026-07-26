//! Pure address codecs — no OS, no I/O.
//!
//! Two hex dialects exist because two kernels print different things:
//! - **network hex** — one byte → two hex digits, left-to-right (darwin L rows,
//!   and what our TSV emits after decoding).
//! - **`/proc` hex** — each 32-bit word in host order (linux `/proc/net/tcp{,6}`).

/// Network-order bytes → lowercase hex (the L-row form).
pub fn encode_hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        use std::fmt::Write as _;
        let _ = write!(s, "{b:02x}");
    }
    s
}

/// Inverse of [`encode_hex`]. Accepts only 8 or 32 hex digits (v4 / v6).
pub fn decode_network_hex(hex: &str) -> Result<Vec<u8>, ()> {
    if (hex.len() != 8 && hex.len() != 32) || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(());
    }
    let raw = hex.as_bytes();
    let mut bytes = Vec::with_capacity(hex.len() / 2);
    let mut i = 0;
    while i < raw.len() {
        let h = std::str::from_utf8(&raw[i..i + 2]).map_err(|_| ())?;
        bytes.push(u8::from_str_radix(h, 16).map_err(|_| ())?);
        i += 2;
    }
    Ok(bytes)
}

/// `/proc/net/tcp{,6}` local_address hex → network-order bytes.
///
/// The kernel prints each 32-bit word in HOST order; reverse per word.
pub fn decode_proc_hex(hex: &str) -> Result<Vec<u8>, ()> {
    if (hex.len() != 8 && hex.len() != 32) || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(());
    }
    let raw = hex.as_bytes();
    let mut bytes = Vec::with_capacity(hex.len() / 2);
    let mut word = 0;
    while word < raw.len() {
        for byte in (0..4).rev() {
            let i = word + byte * 2;
            let h = std::str::from_utf8(&raw[i..i + 2]).map_err(|_| ())?;
            bytes.push(u8::from_str_radix(h, 16).map_err(|_| ())?);
        }
        word += 8;
    }
    Ok(bytes)
}

/// Host-order `/proc` hex for network-order bytes (the inverse of
/// [`decode_proc_hex`]) — used by proptest round-trips.
pub fn encode_proc_hex(bytes: &[u8]) -> Result<String, ()> {
    if bytes.len() != 4 && bytes.len() != 16 {
        return Err(());
    }
    let mut s = String::with_capacity(bytes.len() * 2);
    let mut off = 0;
    while off < bytes.len() {
        for byte in (0..4).rev() {
            use std::fmt::Write as _;
            let _ = write!(s, "{:02x}", bytes[off + byte]);
        }
        off += 4;
    }
    Ok(s)
}
