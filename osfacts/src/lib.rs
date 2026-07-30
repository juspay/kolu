//! Pure + shared surface for the osfacts binary and its test suite.
//!
//! Platform OS reads stay in the binary (`main` + `linux`/`darwin`). What
//! lives here is the versioned schema, the pure address-slot decode, the pure
//! `/proc` address word-swap, the pure darwin `pcblist_n` decode + merge, and
//! the pure unix-socket decoders both platforms' holder readers stand on —
//! the pieces proptest and unit tests pin without touching the OS, on every
//! platform rather than only the one that can read them.

pub mod decode;
pub mod pcblist;
pub mod proc_addr;
pub mod schema;
pub mod unix_socket;

pub use decode::{slot_from_vflag, AddressSlot, AF_INET, AF_INET6, INI_IPV4, INI_IPV6};
pub use pcblist::{
    attribute_host_listeners, decode_host_listeners, HostListener, TCP_STATE_LISTEN,
};
pub use proc_addr::{decode_network_hex, decode_proc_hex, encode_hex, encode_proc_hex};
pub use schema::{
    blind_or_empty, encode_tsv_string, encode_tsv_strings, errno_name, hex_bytes, sanitize_name,
    source_error, Attribution, Cpu, Disk, Facet, HostMemory, HostSnapshot, Load, Memory, Network,
    Port, Proc, ProcessArgv, ProcessCpuTime, ProcessCwd, ProcessStatus, ProcessUid, Snapshot,
    SocketHolders, SourceError, StartTime, Swap, Unreadable, BLIND_OR_EMPTY, SCHEMA_VERSION,
};
pub use unix_socket::{sockaddr_un_path, unix_socket_inodes};
