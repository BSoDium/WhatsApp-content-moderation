const DNS_ERROR_CODES = new Set(['EAI_AGAIN', 'ENOTFOUND']);

interface DnsFailureWatchdogOptions {
  maxFailingMs: number;
  onTripped: () => void;
  now?: () => number;
}

/**
 * Detects a connection that has been failing on name resolution alone for
 * `maxFailingMs`. A host-network container gets a one-time copy of the host's
 * `/etc/resolv.conf` when it starts, so a boot that races the host's resolver
 * setup (Tailscale, systemd-resolved) leaves it unable to resolve anything
 * even after the host recovers — only a container restart re-copies the file.
 * `onTripped` is expected to exit the process and let the restart policy do it.
 *
 * Any non-DNS close or a successful open resets the clock, so an ordinary
 * flaky link never trips it.
 */
export function createDnsFailureWatchdog({ maxFailingMs, onTripped, now = Date.now }: DnsFailureWatchdogOptions) {
  let failingSince: number | null = null;

  return {
    recordClose(errorCode: string | undefined): void {
      if (!errorCode || !DNS_ERROR_CODES.has(errorCode)) {
        failingSince = null;
        return;
      }
      failingSince ??= now();
      if (now() - failingSince >= maxFailingMs) {
        failingSince = null;
        onTripped();
      }
    },
    recordOpen(): void {
      failingSince = null;
    },
  };
}
