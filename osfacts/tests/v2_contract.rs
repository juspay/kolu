//! OSF3 + OSF6 + OSF7 contract pins. These are self-referential fixtures:
//! they assert facts about processes/sockets created by this test, never host
//! inventory accidents.

mod common;

use common::{osfacts, Listener};

fn rows(stdout: &str, tag: &str) -> Vec<Vec<String>> {
    stdout
        .lines()
        .filter_map(|line| {
            let fields: Vec<String> = line.split('\t').map(str::to_owned).collect();
            (fields.first().is_some_and(|field| field == tag)).then_some(fields)
        })
        .collect()
}

#[test]
fn mem_and_start_time_are_independent_pid_facets() {
    let pid = std::process::id();
    let out = osfacts()
        .args([
            "snapshot",
            "--pids",
            &pid.to_string(),
            "--mem",
            "--start-time",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let stdout = String::from_utf8(out).expect("utf8");
    assert!(stdout.starts_with("V\t2\n"), "{stdout}");

    let memory = rows(&stdout, "M");
    assert_eq!(memory.len(), 1, "{stdout}");
    assert_eq!(memory[0][1], pid.to_string());
    assert!(memory[0][2].parse::<u64>().expect("rss bytes") > 0);

    let starts = rows(&stdout, "S");
    assert_eq!(starts.len(), 1, "{stdout}");
    assert_eq!(starts[0][1], pid.to_string());
    let start_us = starts[0][2].parse::<u64>().expect("epoch microseconds");
    let now_us = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock after epoch")
        .as_micros() as u64;
    assert!(start_us > 1_000_000_000_000_000, "{start_us}");
    assert!(start_us <= now_us, "start={start_us}, now={now_us}");
}

#[test]
fn narrow_scope_emits_unclaimed_host_listener() {
    let claimed = Listener::spawn("127.0.0.1");
    let outside = Listener::spawn("127.0.0.1");
    let out = osfacts()
        .args(["snapshot", "--pids", &claimed.pid.to_string(), "--ports"])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let stdout = String::from_utf8(out).expect("utf8");
    let listeners = rows(&stdout, "L");

    let claimed_row = listeners
        .iter()
        .find(|row| row.get(4) == Some(&claimed.port.to_string()))
        .unwrap_or_else(|| panic!("claimed fixture missing:\n{stdout}"));
    assert_eq!(claimed_row[1], "claimed");
    assert_eq!(claimed_row[2], claimed.pid.to_string());

    let outside_row = listeners
        .iter()
        .find(|row| row.get(4) == Some(&outside.port.to_string()))
        .unwrap_or_else(|| panic!("out-of-scope fixture missing:\n{stdout}"));
    assert_eq!(outside_row[1], "unclaimed");
    assert_eq!(outside_row[2], "-");
    #[cfg(target_os = "linux")]
    assert_eq!(outside_row[3], unsafe { libc::geteuid() }.to_string());
}

#[test]
fn host_emits_cumulative_machine_facts() {
    let out = osfacts()
        .args(["host", "--load", "--mem", "--cpu", "--net", "--disk"])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let stdout = String::from_utf8(out).expect("utf8");
    assert!(stdout.starts_with("V\t2\n"), "{stdout}");
    for tag in ["HLOAD", "HMEM", "HSWAP", "HUP", "HCPU", "HNET", "HDISK"] {
        assert!(!rows(&stdout, tag).is_empty(), "missing {tag}:\n{stdout}");
    }

    let mem = &rows(&stdout, "HMEM")[0];
    let total = mem[1].parse::<u64>().expect("total memory");
    let available = mem[2].parse::<u64>().expect("available memory");
    assert!(total > 0 && available <= total, "{mem:?}");

    let disk = &rows(&stdout, "HDISK")[0];
    let total = disk[2].parse::<u64>().expect("total disk");
    let available = disk[3].parse::<u64>().expect("available disk");
    assert_eq!(disk[1], "/");
    assert!(total > 0 && available <= total, "{disk:?}");
}
