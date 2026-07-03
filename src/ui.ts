// Terminal UI helpers: gradient text, an animated spinner, and a themed
// word list, used to make waiting on network calls feel alive instead of
// staring at a blank terminal.

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";

/** Blue -> purple -> red, the classic glowing gradient. */
const GRADIENT_STOPS: [number, number, number][] = [
  [59, 130, 246], // blue
  [147, 51, 234], // purple
  [236, 72, 153], // pink/magenta
  [239, 68, 68], // red
];

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function colorAt(t: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  const scaled = clamped * (GRADIENT_STOPS.length - 1);
  const i = Math.min(GRADIENT_STOPS.length - 2, Math.floor(scaled));
  const localT = scaled - i;
  const [r1, g1, b1] = GRADIENT_STOPS[i];
  const [r2, g2, b2] = GRADIENT_STOPS[i + 1];
  return [lerp(r1, r2, localT), lerp(g1, g2, localT), lerp(b1, b2, localT)];
}

/**
 * Renders `text` with each character colored along the blue -> purple ->
 * red gradient, optionally offset by `phase` (0..1) to animate a "flowing"
 * effect across frames.
 */
export function gradientText(text: string, phase = 0): string {
  const chars = [...text];
  if (chars.length === 0) return text;
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === " ") {
      out += ch;
      continue;
    }
    const t = ((i / Math.max(1, chars.length - 1)) + phase) % 1;
    const [r, g, b] = colorAt(t);
    out += `\x1b[38;2;${r};${g};${b}m${ch}`;
  }
  return out + RESET;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Arcane / obscure hacking-flavored verbs and phrases, cycled through while
 * a probe run is in flight. Deliberately overwrought — this is flavor text,
 * not a status report.
 */
export const HACKER_WORDS: string[] = [
  "hacking mainframe",
  "cracking ciphers",
  "bypassing guardrails",
  "spoofing headers",
  "brute-forcing tokens",
  "decrypting payloads",
  "jailbreaking persona",
  "poisoning context",
  "exfiltrating secrets",
  "socially engineering",
  "phreaking the uplink",
  "rooting the sandbox",
  "spelunking the prompt",
  "smuggling instructions",
  "pwning guardrails",
  "injecting payloads",
  "obfuscating intent",
  "escalating privileges",
  "sniffing packets",
  "fuzzing endpoints",
  "backdooring context",
  "unmasking system prompt",
  "compiling exploits",
  "reticulating splines",
  "warming up the exploit",
  "priming the payload",
  "scanning attack surface",
  "probing defenses",
  "triangulating weaknesses",
  "deobfuscating replies",
  "siphoning tokens",
  "cloaking the request",
  "tunneling through auth",
  "rerouting through proxies",
  "cache poisoning",
  "shimming the shell",
  "hijacking the goal",
  "seeding false memories",
  "forging prior turns",
  "decoding the mainframe",
  "spinning up the crescendo",
];

function pickWord(exclude?: string): string {
  let word = HACKER_WORDS[Math.floor(Math.random() * HACKER_WORDS.length)];
  if (word === exclude && HACKER_WORDS.length > 1) {
    return pickWord(exclude);
  }
  return word;
}

export interface SpinnerOptions {
  /** How often to advance the spinner frame / gradient phase, in ms. */
  frameIntervalMs?: number;
  /** How often to swap the flavor word, in ms. */
  wordIntervalMs?: number;
  stream?: NodeJS.WriteStream;
}

/**
 * A Claude-Code-style animated status line: a braille spinner plus a
 * gradient-colored flavor word, with an optional fixed status suffix
 * (e.g. "[3/25] rh-01"). Writes to stderr so stdout stays clean for
 * piped/redirected report output.
 */
export class Spinner {
  private frame = 0;
  private phase = 0;
  private word: string;
  private suffix = "";
  private timer?: NodeJS.Timeout;
  private wordTimer?: NodeJS.Timeout;
  private readonly stream: NodeJS.WriteStream;
  private readonly frameIntervalMs: number;
  private readonly wordIntervalMs: number;
  private lastLineLength = 0;
  private active = false;

  constructor(options: SpinnerOptions = {}) {
    this.stream = options.stream ?? process.stderr;
    this.frameIntervalMs = options.frameIntervalMs ?? 80;
    this.wordIntervalMs = options.wordIntervalMs ?? 1400;
    this.word = pickWord();
  }

  start(): void {
    if (this.active || !this.stream.isTTY) return;
    this.active = true;
    this.stream.write(HIDE_CURSOR);
    this.render();
    this.timer = setInterval(() => {
      this.frame = (this.frame + 1) % SPINNER_FRAMES.length;
      this.phase = (this.phase + 0.04) % 1;
      this.render();
    }, this.frameIntervalMs);
    this.wordTimer = setInterval(() => {
      this.word = pickWord(this.word);
    }, this.wordIntervalMs);
  }

  /** Update the fixed suffix shown after the flavor word, e.g. progress counters. */
  setSuffix(suffix: string): void {
    this.suffix = suffix;
  }

  private render(): void {
    const spinnerChar = SPINNER_FRAMES[this.frame];
    const label = gradientText(`${this.word}...`, this.phase);
    const suffixPart = this.suffix ? `  ${DIM}${this.suffix}${RESET}` : "";
    const line = `${gradientText(spinnerChar, this.phase)} ${label}${suffixPart}`;
    const visibleLength = spinnerChar.length + 1 + this.word.length + 3 + this.suffix.length + 2;
    this.stream.write(`\r${" ".repeat(this.lastLineLength)}\r${line}`);
    this.lastLineLength = visibleLength;
  }

  /** Stops the animation and clears the line, optionally printing a final message. */
  stop(finalMessage?: string): void {
    if (this.timer) clearInterval(this.timer);
    if (this.wordTimer) clearInterval(this.wordTimer);
    this.timer = undefined;
    this.wordTimer = undefined;
    if (this.active) {
      this.stream.write(`\r${" ".repeat(this.lastLineLength)}\r`);
      this.stream.write(SHOW_CURSOR);
    }
    this.active = false;
    if (finalMessage) {
      this.stream.write(finalMessage + "\n");
    }
  }
}

function padVisible(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  return text + " ".repeat(width - text.length);
}

function wrapText(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > width && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export type WarningVariant = "danger" | "caution";

/** Bold, high-contrast text-on-solid-color styles — deliberately loud. */
const WARNING_STYLES: Record<WarningVariant, string> = {
  danger: "\x1b[1m\x1b[97m\x1b[41m", // bold white on red
  caution: "\x1b[1m\x1b[30m\x1b[43m", // bold black on yellow
};

const WARNING_ICON: Record<WarningVariant, string> = {
  danger: "⚠️ ",
  caution: "⚠️ ",
};

/**
 * A high-contrast, gradient-bordered alert block. Used for things the user
 * must not miss: mock mode being active, or free-tier throttling kicking in.
 */
export function warningBlock(message: string, variant: WarningVariant = "danger"): string {
  const termWidth = process.stdout.columns ?? 100;
  const width = Math.max(40, Math.min(96, termWidth - 2));
  const innerWidth = width - 4;

  const style = WARNING_STYLES[variant];
  const icon = WARNING_ICON[variant];
  const wrapped = wrapText(`${icon}${message}`, innerWidth);

  const rule = gradientText("▀".repeat(width));
  const ruleBottom = gradientText("▄".repeat(width));
  const body = wrapped.map((line) => `${style} ${padVisible(line, innerWidth)} ${RESET}`);

  return [rule, ...body, ruleBottom].join("\n");
}

export function banner(): string {
  const art = [
    " █████╗ ███████╗ ██████╗ ██╗███████╗    ██████╗ ██████╗  ██████╗ ██████╗ ███████╗",
    "██╔══██╗██╔════╝██╔════╝ ██║██╔════╝    ██╔══██╗██╔══██╗██╔═══██╗██╔══██╗██╔════╝",
    "███████║█████╗  ██║  ███╗██║███████╗    ██████╔╝██████╔╝██║   ██║██████╔╝█████╗  ",
    "██╔══██║██╔══╝  ██║   ██║██║╚════██║    ██╔═══╝ ██╔══██╗██║   ██║██╔══██╗██╔══╝  ",
    "██║  ██║███████╗╚██████╔╝██║███████║    ██║     ██║  ██║╚██████╔╝██████╔╝███████╗",
    "╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═╝╚══════╝    ╚═╝     ╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚══════╝",
  ];
  return art.map((line, i) => gradientText(line, i / art.length)).join("\n");
}

export { RESET, BOLD, DIM };
