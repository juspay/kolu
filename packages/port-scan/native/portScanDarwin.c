/*
 * kolu-port-scan-darwin — one host-wide pass over darwin's libproc, printing the
 * two tables padi's port scan joins: the process table and the listening TCP
 * sockets, each attributed to the pid holding it.
 *
 * ## Why this exists
 *
 * The scan used to shell out to `/bin/ps` AND `/usr/sbin/lsof` — two fork/execs
 * per pass, measured at 17 ms on a quiet Mac and 93 ms on a busy one. At the
 * sampler's ≥1 s nudge floor that is ~9% of a core while any terminal streams,
 * which is not a cost a background readout gets to impose. `lsof` also walks
 * every fd of every process to answer a question about *listening TCP sockets*,
 * and then we parse its text back into structure it already had.
 *
 * libproc is the same source `lsof` and `ps` read. Asking it directly removes
 * both subprocesses, both text formats, and the parse.
 *
 * ## The contract with the caller
 *
 * stdout is line-oriented TSV, and the FIRST line is the format version:
 *
 *     V<TAB>1
 *     P<TAB><pid><TAB><ppid><TAB><name>
 *     L<TAB><pid><TAB><port><TAB><hex-bind-address>
 *
 * `P` rows are the process table; `L` rows are listening TCP sockets. The
 * version is first so a padi built against a different helper fails LOUDLY on a
 * shape it does not know instead of silently reading zero ports — the whole
 * failure mode this feature must never have.
 *
 * `<name>` is LAST on its line because it may contain spaces (and tabs are
 * stripped from it, so the field count is fixed). It is the basename of the
 * executable path from `proc_pidpath` when that is readable, falling back to
 * libproc's `pbi_name`. Deliberately the path's basename rather than the short
 * comm: comm is truncated to 16 bytes AND, for a threaded runtime, reports the
 * THREAD name — which is how every Node dev server once came out labelled
 * `MainThread`.
 *
 * `<hex-bind-address>` is the RAW bind address, 8 hex chars for IPv4 and 32 for
 * IPv6, so the JS side keeps exactly one classifier (`isAnyAddress`) shared with
 * the linux `/proc` reader. The helper deliberately does NOT decide wildcardness:
 * two predicates that must agree about `::ffff:0.0.0.0` is how they come to
 * disagree.
 *
 * ## Visibility, and why it is enough
 *
 * Run as a normal user, `proc_pidinfo(PROC_PIDLISTFDS)` returns EPERM for other
 * users' processes, so their sockets are invisible. That is the same limit
 * non-root `lsof` had, and it is sufficient BY CONSTRUCTION: padi attributes
 * ports to its own terminals' process subtrees, and those are padi's own uid.
 * A pid we cannot inspect is skipped, never fatal — the caller's blindness policy
 * (only an unreadable REQUESTED ROOT is fatal) lives in padi, which is the only
 * layer that knows which pids were asked about.
 *
 * Exit status: 0 on a completed pass (even one that found nothing), 1 on a
 * failure that means the pass could not be trusted.
 */

#include <arpa/inet.h>
#include <errno.h>
#include <libproc.h>
#include <netinet/in.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/proc_info.h>
#include <sys/sysctl.h>

/* Bumped only when the stdout grammar above changes shape. padi refuses a
 * version it does not know. */
#define FORMAT_VERSION 1

/* Print the process name with tabs and newlines stripped, so `<name>` can be the
 * last field of a fixed-arity line even for an executable with a hostile name. */
static void print_sanitized(const char *s) {
  for (; *s != '\0'; s++) {
    unsigned char c = (unsigned char)*s;
    putchar(c == '\t' || c == '\n' || c == '\r' ? ' ' : c);
  }
}

/* argv[0]'s basename, or the whole string when it has no slash. */
static const char *basename_of(const char *path) {
  const char *slash = strrchr(path, '/');
  return slash == NULL ? path : slash + 1;
}

/* Emit the `P` row for one pid. Returns 0 when the pid could not be read at all
 * (an exit race, or a process we have no rights to), which is not an error. */
static int emit_process(pid_t pid) {
  struct proc_bsdinfo bsd;
  int n = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &bsd, sizeof(bsd));
  if (n < (int)sizeof(bsd)) return 0;

  /* The executable path is the honest name; `pbi_name` is the fallback for a pid
   * whose path we cannot read (it is still better than nothing, and it is what
   * `ps -o comm` would have shown). */
  char path[PROC_PIDPATHINFO_MAXSIZE];
  const char *name;
  if (proc_pidpath(pid, path, sizeof(path)) > 0) {
    name = basename_of(path);
  } else if (bsd.pbi_name[0] != '\0') {
    name = bsd.pbi_name;
  } else {
    name = bsd.pbi_comm;
  }

  printf("P\t%d\t%d\t", (int)pid, (int)bsd.pbi_ppid);
  print_sanitized(name);
  putchar('\n');
  return 1;
}

/* Emit an `L` row per listening TCP socket this pid holds. */
static void emit_listeners(pid_t pid) {
  int size = proc_pidinfo(pid, PROC_PIDLISTFDS, 0, NULL, 0);
  if (size <= 0) return; /* EPERM (not our uid) or no fds — both are skips. */

  /* Slack: the fd table can grow between the sizing call and the read. */
  size += 32 * (int)sizeof(struct proc_fdinfo);
  struct proc_fdinfo *fds = malloc((size_t)size);
  if (fds == NULL) return;

  int used = proc_pidinfo(pid, PROC_PIDLISTFDS, 0, fds, size);
  if (used <= 0) {
    free(fds);
    return;
  }
  int count = used / (int)sizeof(struct proc_fdinfo);

  for (int i = 0; i < count; i++) {
    if (fds[i].proc_fdtype != PROX_FDTYPE_SOCKET) continue;

    struct socket_fdinfo si;
    int n = proc_pidfdinfo(pid, fds[i].proc_fd, PROC_PIDFDSOCKETINFO, &si,
                           sizeof(si));
    if (n < (int)sizeof(si)) continue; /* fd closed under us, or not readable */
    if (si.psi.soi_kind != SOCKINFO_TCP) continue;
    if (si.psi.soi_proto.pri_tcp.tcpsi_state != TSI_S_LISTEN) continue;

    const struct in_sockinfo *ini = &si.psi.soi_proto.pri_tcp.tcpsi_ini;
    /* `insi_lport` is in network byte order, like every other sockaddr port. */
    int port = ntohs((uint16_t)ini->insi_lport);
    if (port <= 0) continue;

    /* WHICH slot of `insi_laddr` holds the address? `soi_family` does not say —
     * `insi_vflag` does, and the ORDER of the two flag checks is load-bearing.
     *
     * Measured on macOS 27.0, by binding each shape and reading `getsockname`
     * beside this very struct:
     *
     *   bind               soi_family  insi_vflag           v4 slot     v6 slot
     *   ::ffff:127.0.0.1   AF_INET6    0x01 (v4 only)       7f000001    ::127.0.0.1
     *   ::  (dual-stack)   AF_INET6    0x03 (BOTH)          00000000    ::
     *   ::1                AF_INET6    0x02 (v6 only)       00000001 !  ::1
     *   127.0.0.1          AF_INET     0x01                 7f000001    -
     *
     * So INI_IPV6 must be tested FIRST: a dual-stack socket sets BOTH flags, and
     * an earlier revision of this file tested INI_IPV4 first — which reported a
     * `::` bind as `0.0.0.0`. And the v4 slot is never safe to read without
     * INI_IPV4: for `::1` it holds `00000001`, which would surface as `0.0.0.1`.
     *
     * On the severity of the bug this replaces, stated honestly: it was a
     * FIDELITY loss, not a CLASSIFICATION error. `0.0.0.0` and `::` both answer
     * `isAnyAddress`, so no chip ever rendered wrongly because of it. It still had
     * to go — PRT2 forwards to addresses rather than merely classifying them, and
     * a reader that silently narrows a dual-stack listener to its v4 half is
     * wrong in the record even when it happens to be right in the outcome. The
     * same defect was found in an unrelated tool (`portview`) while surveying
     * alternatives; we do not get to hold anyone else to a bar this file misses.
     *
     * A v4-mapped bind is still emitted as the FOUR-byte v4 form rather than the
     * 16-byte mapped one. That is a representation choice, not a fidelity one —
     * `127.0.0.1` and `::ffff:127.0.0.1` are the same address, it matches what
     * `lsof` prints for that socket, and the consumer canonicalises the two
     * together anyway. */
    int v4;
    if (si.psi.soi_family == AF_INET) {
      v4 = 1; /* AF_INET can only be v4 */
    } else if (ini->insi_vflag & INI_IPV6) {
      v4 = 0; /* genuine v6, INCLUDING dual-stack (both flags set) */
    } else if (ini->insi_vflag & INI_IPV4) {
      v4 = 1; /* v4-mapped: the address lives in the 4-byte slot */
    } else {
      v4 = 0; /* neither flag: trust the family rather than invent a slot */
    }

    printf("L\t%d\t%d\t", (int)pid, port);
    if (v4) {
      const unsigned char *b =
          (const unsigned char *)&ini->insi_laddr.ina_46.i46a_addr4.s_addr;
      for (int k = 0; k < 4; k++) printf("%02x", b[k]);
    } else {
      const unsigned char *b =
          (const unsigned char *)&ini->insi_laddr.ina_6;
      for (int k = 0; k < 16; k++) printf("%02x", b[k]);
    }
    putchar('\n');
  }
  free(fds);
}

int main(void) {
  /* Size the pid list, then read it with slack — the table can grow in between,
   * and a truncated read would silently drop processes (a missing subtree reads
   * as "this terminal serves nothing", the lie this whole feature avoids). */
  int bytes = proc_listpids(PROC_ALL_PIDS, 0, NULL, 0);
  if (bytes <= 0) {
    fprintf(stderr, "kolu-port-scan: proc_listpids sizing failed: %s\n",
            strerror(errno));
    return 1;
  }
  bytes += 64 * (int)sizeof(pid_t);
  pid_t *pids = malloc((size_t)bytes);
  if (pids == NULL) {
    fprintf(stderr, "kolu-port-scan: out of memory\n");
    return 1;
  }
  int used = proc_listpids(PROC_ALL_PIDS, 0, pids, bytes);
  if (used <= 0) {
    fprintf(stderr, "kolu-port-scan: proc_listpids failed: %s\n",
            strerror(errno));
    free(pids);
    return 1;
  }
  int count = used / (int)sizeof(pid_t);

  printf("V\t%d\n", FORMAT_VERSION);
  for (int i = 0; i < count; i++) {
    /* proc_listpids zero-pads the tail of the buffer. */
    if (pids[i] <= 0) continue;
    if (emit_process(pids[i]) == 0) continue;
    emit_listeners(pids[i]);
  }
  free(pids);

  /* A short write to a closed pipe must not read as a complete pass. */
  if (fflush(stdout) != 0) {
    fprintf(stderr, "kolu-port-scan: stdout write failed: %s\n",
            strerror(errno));
    return 1;
  }
  return 0;
}
