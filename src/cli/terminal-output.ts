// Deliberately plain console output, not pino — see index.ts's
// ALLOWED_TAILSCALE_LOGIN comment for why the handful of messages a
// first-run operator actually needs to read in `docker compose logs` can't
// be a structured JSON log line that's easy to scroll past.

// Per https://no-color.org: "regardless of its value" — presence alone
// disables color, so NO_COLOR='' (however it ends up set) still counts.
const NO_COLOR = process.env.NO_COLOR !== undefined;

// Colors are forced on rather than TTY-detected: under Docker (this app's
// documented install path — see docker-compose.yml) the app's own stdout is
// a pipe, not a tty, even though the operator is watching it in a real,
// color-capable terminal via `docker compose logs -f`. NO_COLOR
// (https://no-color.org) is still the escape hatch for anyone redirecting
// this output to a file instead.
const ANSI_BOLD = 1;
const ANSI_GREEN = 32;
const ANSI_YELLOW = 33;
const ANSI_CYAN = 36;

function paint(code: number, text: string): string {
  return NO_COLOR ? text : `\u001b[${code}m${text}\u001b[0m`;
}

export const colors = {
  bold: (text: string) => paint(ANSI_BOLD, text),
  green: (text: string) => paint(ANSI_GREEN, text),
  yellow: (text: string) => paint(ANSI_YELLOW, text),
  cyan: (text: string) => paint(ANSI_CYAN, text),
};

function printBanner(lines: string[], color: (text: string) => string, write: (text: string) => void): void {
  write(['', ...lines.map((line) => color(line)), ''].join('\n'));
}

export function printWarningBanner(lines: string[]): void {
  printBanner(lines, colors.yellow, (text) => console.warn(text));
}

export function printSuccessBanner(lines: string[]): void {
  printBanner(lines, colors.green, (text) => console.log(text));
}
