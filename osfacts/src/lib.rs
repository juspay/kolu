//! Pure + shared surface for the osfacts binary and its test suite.
//!
//! Platform OS reads stay in the binary (`main` + `linux`/`darwin`). What
//! lives here is the versioned schema, the pure address-slot decode, and the
//! pure `/proc` address word-swap — the pieces proptest and unit tests pin
//! without touching the OS.

pub mod decode;
pub mod proc_addr;
pub mod schema;

pub use decode::{slot_from_vflag, AddressSlot, AF_INET, AF_INET6, INI_IPV4, INI_IPV6};
pub use proc_addr::{decode_network_hex, decode_proc_hex, encode_hex, encode_proc_hex};
pub use schema::{
    encode_tsv_string, encode_tsv_strings, errno_name, hex_bytes, sanitize_name, Attribution, Cpu,
    Disk, HostMemory, HostSnapshot, Load, Memory, Network, Port, Proc, ProcessArgv, ProcessCpuTime,
    ProcessCwd, ProcessStatus, ProcessUid, Snapshot, SourceError, StartTime, Swap, Unreadable,
    SCHEMA_VERSION,
};
