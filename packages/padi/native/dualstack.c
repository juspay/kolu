/* A dual-stack listener, for `default.nix`'s install check — NOT part of the
 * shipped helper.
 *
 * It binds `::` with IPV6_V6ONLY off, which is the one case that makes darwin set
 * BOTH INI_IPV4 and INI_IPV6 in `insi_vflag`. An earlier revision of the helper
 * tested INI_IPV4 first and so reported such a socket as `0.0.0.0` — a fixture
 * cannot catch that, only a real socket can, so the check binds one and reads the
 * emitted address bytes back.
 *
 * Prints the kernel-assigned port, then holds the socket open long enough for the
 * helper to see it.
 */
#include <netinet/in.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

int main(void) {
  int fd = socket(AF_INET6, SOCK_STREAM, 0);
  if (fd < 0) return 2;
  int off = 0; /* dual-stack: v6only OFF, so both vflag bits get set */
  setsockopt(fd, IPPROTO_IPV6, IPV6_V6ONLY, &off, sizeof(off));
  struct sockaddr_in6 sa;
  memset(&sa, 0, sizeof(sa));
  sa.sin6_family = AF_INET6;
  sa.sin6_len = sizeof(sa);
  sa.sin6_addr = in6addr_any; /* :: */
  if (bind(fd, (struct sockaddr *)&sa, sizeof(sa)) < 0) return 2;
  if (listen(fd, 4) < 0) return 2;
  socklen_t n = sizeof(sa);
  if (getsockname(fd, (struct sockaddr *)&sa, &n) < 0) return 2;
  printf("%d\n", ntohs(sa.sin6_port)); /* port 0 -> the kernel picks a free one */
  fflush(stdout);
  sleep(20);
  return 0;
}
