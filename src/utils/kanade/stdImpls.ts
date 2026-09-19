// Mirrors hana/std/stdimpl (the Go behavior of every native standard-library
// function), keyed by language-neutral ID. Change the Go first and match it here:
// compare_tests.ts checks that both give the same results.
import { RuntimeError, Codes } from "./errs";

type Impl = (...args: unknown[]) => unknown;

function exactly(args: unknown[], n: number): void {
  if (args.length !== n) throw new RuntimeError(Codes.ArgCountExact, n);
}

function between(args: unknown[], min: number, max: number): void {
  if (args.length < min || args.length > max) throw new RuntimeError(Codes.ArgCountRange, min, max);
}

function stringArg(args: unknown[], i: number): string {
  const v = args[i];
  if (typeof v !== "string") throw new RuntimeError(Codes.NativeArgString, i + 1);
  return v;
}

function numberArg(args: unknown[], i: number): number {
  const v = args[i];
  if (typeof v !== "number") throw new RuntimeError(Codes.NativeArgNumber, i + 1);
  return v;
}

const MAX_SAFE_INTEGER = 9007199254740992;

function integerArg(args: unknown[], i: number): number {
  const v = args[i];
  if (typeof v !== "number" || !Number.isInteger(v) || Math.abs(v) > MAX_SAFE_INTEGER) {
    throw new RuntimeError(Codes.NativeArgInteger, i + 1);
  }
  return v;
}

function listArg(args: unknown[], i: number): unknown[] {
  const v = args[i];
  if (!Array.isArray(v)) throw new RuntimeError(Codes.NativeArgList, i + 1);
  return v;
}

function numberFunc(f: (n: number) => number): Impl {
  return (...args) => {
    exactly(args, 1);
    if (typeof args[0] !== "number") throw new RuntimeError(Codes.NotANumber);
    return f(args[0]);
  };
}

// ---- json

function fromJSON(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(fromJSON);
  if (v !== null && typeof v === "object") {
    const dict = new Map<unknown, unknown>();
    for (const [k, el] of Object.entries(v)) dict.set(k, fromJSON(el));
    return dict;
  }
  if (typeof v === "number" && !Number.isFinite(v)) throw new RuntimeError(Codes.JSONInvalid);
  return v;
}

function jsonParse(...args: unknown[]): unknown {
  exactly(args, 1);
  const text = stringArg(args, 0);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new RuntimeError(Codes.JSONInvalid);
  }
  return fromJSON(raw);
}

function newline(indent: number, depth: number): string {
  return indent === 0 ? "" : "\n" + " ".repeat(indent * depth);
}

function writeJSON(v: unknown, indent: number, depth: number): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new RuntimeError(Codes.JSONUnsupported);
    return String(v);
  }
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    const items = v.map((el) => newline(indent, depth + 1) + writeJSON(el, indent, depth + 1));
    return "[" + items.join(",") + newline(indent, depth) + "]";
  }
  if (v instanceof Map) {
    if (v.size === 0) return "{}";
    const keys: string[] = [];
    for (const k of v.keys()) {
      if (typeof k !== "string") throw new RuntimeError(Codes.JSONUnsupported);
      keys.push(k);
    }
    keys.sort(compareBytes);
    const items = keys.map(
      (k) => newline(indent, depth + 1) + JSON.stringify(k) + ":" + (indent > 0 ? " " : "") + writeJSON(v.get(k), indent, depth + 1),
    );
    return "{" + items.join(",") + newline(indent, depth) + "}";
  }
  throw new RuntimeError(Codes.JSONUnsupported);
}

// Go sorts strings by UTF-8 bytes, which is code point order; JS's default sort
// is by UTF-16 units, which differs for characters past U+FFFF.
function compareBytes(a: string, b: string): number {
  const ax = Array.from(a);
  const bx = Array.from(b);
  const n = Math.min(ax.length, bx.length);
  for (let i = 0; i < n; i++) {
    const d = ax[i].codePointAt(0)! - bx[i].codePointAt(0)!;
    if (d !== 0) return d;
  }
  return ax.length - bx.length;
}

function jsonStringify(...args: unknown[]): unknown {
  between(args, 1, 2);
  let indent = 0;
  if (args.length === 2) {
    const n = integerArg(args, 1);
    if (n < 0 || n > 10) throw new RuntimeError(Codes.NativeArgInteger, 2);
    indent = n;
  }
  return writeJSON(args[0], indent, 0);
}

// ---- random

function randomFloat(...args: unknown[]): unknown {
  exactly(args, 0);
  return Math.random();
}

function randomInt(...args: unknown[]): unknown {
  exactly(args, 2);
  const min = integerArg(args, 0);
  const max = integerArg(args, 1);
  if (min > max) throw new RuntimeError(Codes.RandomRange, min, max);
  return min + Math.floor(Math.random() * (max - min + 1));
}

function randomChoice(...args: unknown[]): unknown {
  exactly(args, 1);
  const list = listArg(args, 0);
  if (list.length === 0) throw new RuntimeError(Codes.RandomEmpty);
  return list[Math.floor(Math.random() * list.length)];
}

function randomShuffle(...args: unknown[]): unknown {
  exactly(args, 1);
  const out = listArg(args, 0).slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---- datetime

const DATE_TOKENS = ["YYYY", "MM", "DD", "HH", "mm", "ss"] as const;

function tokenAt(layout: string, i: number): string {
  for (const token of DATE_TOKENS) if (layout.startsWith(token, i)) return token;
  return "";
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

function datetimeNow(...args: unknown[]): unknown {
  exactly(args, 0);
  return Date.now() / 1000;
}

function datetimeFormat(...args: unknown[]): unknown {
  exactly(args, 2);
  const seconds = numberArg(args, 0);
  const layout = stringArg(args, 1);
  if (!Number.isFinite(seconds) || Math.abs(seconds) > 8.64e12) throw new RuntimeError(Codes.NativeArgNumber, 1);
  const t = new Date(Math.floor(seconds) * 1000);

  let out = "";
  for (let i = 0; i < layout.length; ) {
    const token = tokenAt(layout, i);
    switch (token) {
      case "YYYY": out += pad(t.getFullYear(), 4); break;
      case "MM": out += pad(t.getMonth() + 1, 2); break;
      case "DD": out += pad(t.getDate(), 2); break;
      case "HH": out += pad(t.getHours(), 2); break;
      case "mm": out += pad(t.getMinutes(), 2); break;
      case "ss": out += pad(t.getSeconds(), 2); break;
      default:
        out += layout[i];
        i++;
        continue;
    }
    i += token.length;
  }
  return out;
}

function datetimeParse(...args: unknown[]): unknown {
  exactly(args, 2);
  const text = stringArg(args, 0);
  const layout = stringArg(args, 1);
  const invalid = () => new RuntimeError(Codes.DateInvalid, text);

  const parts: Record<string, number> = { YYYY: 1970, MM: 1, DD: 1, HH: 0, mm: 0, ss: 0 };
  let pos = 0;
  for (let i = 0; i < layout.length; ) {
    const token = tokenAt(layout, i);
    if (token === "") {
      if (pos >= text.length || text[pos] !== layout[i]) throw invalid();
      pos++;
      i++;
      continue;
    }
    if (pos + token.length > text.length) throw invalid();
    const digits = text.slice(pos, pos + token.length);
    if (!/^[0-9]+$/.test(digits)) throw invalid();
    parts[token] = Number(digits);
    pos += token.length;
    i += token.length;
  }
  if (pos !== text.length) throw invalid();

  // setFullYear keeps years 0-99 as written (the Date constructor maps them to 19xx).
  const t = new Date(2000, 0, 1, 0, 0, 0, 0);
  t.setFullYear(parts.YYYY, parts.MM - 1, parts.DD);
  t.setHours(parts.HH, parts.mm, parts.ss, 0);
  if (
    t.getFullYear() !== parts.YYYY || t.getMonth() + 1 !== parts.MM || t.getDate() !== parts.DD ||
    t.getHours() !== parts.HH || t.getMinutes() !== parts.mm || t.getSeconds() !== parts.ss
  ) {
    throw invalid();
  }
  return Math.floor(t.getTime() / 1000);
}

// ---- regex

// A leading (?ims) group sets flags, like Go's syntax; the rest is the JS pattern.
function compile(pattern: string, extraFlags = ""): RegExp {
  let flags = "u" + extraFlags;
  let source = pattern;
  const lead = /^\(\?([ims]+)\)/.exec(pattern);
  if (lead) {
    for (const f of lead[1]) if (!flags.includes(f)) flags += f;
    source = pattern.slice(lead[0].length);
  }
  try {
    return new RegExp(source, flags);
  } catch {
    throw new RuntimeError(Codes.RegexInvalid, pattern);
  }
}

function textAndPattern(args: unknown[], extraFlags = ""): [string, RegExp] {
  const text = stringArg(args, 0);
  const pattern = stringArg(args, 1);
  return [text, compile(pattern, extraFlags)];
}

// The non-empty matches of text; the two engines differ on empty ones.
function nonEmptyMatches(text: string, re: RegExp): RegExpMatchArray[] {
  return Array.from(text.matchAll(re)).filter((m) => m[0].length > 0);
}

function regexTest(...args: unknown[]): unknown {
  exactly(args, 2);
  const [text, re] = textAndPattern(args);
  return re.test(text);
}

function regexFind(...args: unknown[]): unknown {
  exactly(args, 2);
  const [text, re] = textAndPattern(args);
  const m = re.exec(text);
  return m ? m[0] : null;
}

function groupList(m: RegExpMatchArray): unknown[] {
  return Array.from(m, (g) => (g === undefined ? null : g));
}

function regexGroups(...args: unknown[]): unknown {
  exactly(args, 2);
  const [text, re] = textAndPattern(args);
  const m = re.exec(text);
  return m ? groupList(m) : null;
}

function regexFindAll(...args: unknown[]): unknown {
  exactly(args, 2);
  const [text, re] = textAndPattern(args, "g");
  return nonEmptyMatches(text, re).map((m) => m[0]);
}

function expandReplacement(replacement: string, groups: unknown[]): string {
  let out = "";
  for (let i = 0; i < replacement.length; i++) {
    const c = replacement[i];
    if (c !== "$" || i + 1 >= replacement.length) {
      out += c;
      continue;
    }
    const next = replacement[i + 1];
    if (next === "$") {
      out += "$";
      i++;
      continue;
    }
    if (next < "0" || next > "9") {
      out += c;
      continue;
    }
    let j = i + 1;
    while (j < replacement.length && replacement[j] >= "0" && replacement[j] <= "9") j++;
    const n = Number(replacement.slice(i + 1, j));
    if (n < groups.length) {
      const g = groups[n];
      if (typeof g === "string") out += g;
    } else {
      out += replacement.slice(i, j);
    }
    i = j - 1;
  }
  return out;
}

function regexReplace(...args: unknown[]): unknown {
  exactly(args, 3);
  const [text, re] = textAndPattern(args, "g");
  const replacement = stringArg(args, 2);
  let out = "";
  let last = 0;
  for (const m of nonEmptyMatches(text, re)) {
    out += text.slice(last, m.index!) + expandReplacement(replacement, groupList(m));
    last = m.index! + m[0].length;
  }
  return out + text.slice(last);
}

function regexSplit(...args: unknown[]): unknown {
  exactly(args, 2);
  const [text, re] = textAndPattern(args, "g");
  const out: string[] = [];
  let last = 0;
  for (const m of nonEmptyMatches(text, re)) {
    out.push(text.slice(last, m.index!));
    last = m.index! + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

export const nativeImpls: Record<string, Impl> = {
  "math.ceil": numberFunc(Math.ceil),
  "math.floor": numberFunc(Math.floor),

  "json.parse": jsonParse,
  "json.stringify": jsonStringify,

  "random.float": randomFloat,
  "random.int": randomInt,
  "random.choice": randomChoice,
  "random.shuffle": randomShuffle,

  "datetime.now": datetimeNow,
  "datetime.format": datetimeFormat,
  "datetime.parse": datetimeParse,

  "regex.test": regexTest,
  "regex.find": regexFind,
  "regex.groups": regexGroups,
  "regex.findall": regexFindAll,
  "regex.replace": regexReplace,
  "regex.split": regexSplit,
};
