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

// 1 for Monday through 7 for Sunday.
function datetimeWeekday(...args: unknown[]): unknown {
  exactly(args, 1);
  const seconds = numberArg(args, 0);
  if (!Number.isFinite(seconds) || Math.abs(seconds) > 8.64e12) throw new RuntimeError(Codes.NativeArgNumber, 1);
  const day = new Date(Math.floor(seconds) * 1000).getDay();
  return day === 0 ? 7 : day;
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

// ---- math (second batch)

// -0 prints as "-0" in Go but "0" in JS, so results are cleaned to 0.
function clean(f: number): number {
  return f === 0 ? 0 : f;
}

function finite(f: number): number {
  if (!Number.isFinite(f)) throw new RuntimeError(Codes.MathDomain);
  return clean(f);
}

function oneNumber(f: (x: number) => number): Impl {
  return (...args) => {
    exactly(args, 1);
    return finite(f(numberArg(args, 0)));
  };
}

function mathPow(...args: unknown[]): unknown {
  exactly(args, 2);
  return finite(Math.pow(numberArg(args, 0), numberArg(args, 1)));
}

// Rounds half away from zero, to a whole number or to 0..15 digits.
function mathRound(...args: unknown[]): unknown {
  between(args, 1, 2);
  const x = numberArg(args, 0);
  let digits = 0;
  if (args.length === 2) {
    digits = integerArg(args, 1);
    if (digits < 0 || digits > 15) throw new RuntimeError(Codes.NativeArgInteger, 2);
  }
  let scale = 1;
  for (let d = 0; d < digits; d++) scale *= 10;
  const r = x * scale;
  return finite((Math.sign(r) * Math.round(Math.abs(r))) / scale);
}

function mathLog(...args: unknown[]): unknown {
  between(args, 1, 2);
  const x = numberArg(args, 0);
  if (x <= 0) throw new RuntimeError(Codes.MathDomain);
  if (args.length === 1) return finite(Math.log(x));
  const base = numberArg(args, 1);
  if (base <= 0 || base === 1) throw new RuntimeError(Codes.MathDomain);
  return finite(Math.log(x) / Math.log(base));
}

function mathPi(...args: unknown[]): unknown {
  exactly(args, 0);
  return Math.PI;
}

function mathGcd(...args: unknown[]): unknown {
  exactly(args, 2);
  let a = Math.abs(integerArg(args, 0));
  let b = Math.abs(integerArg(args, 1));
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

function mathFactorial(...args: unknown[]): unknown {
  exactly(args, 1);
  const n = integerArg(args, 0);
  if (n < 0 || n > 170) throw new RuntimeError(Codes.MathDomain);
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

// ---- stats: every function takes one list of numbers

function numbersArg(args: unknown[], i: number): number[] {
  const list = listArg(args, i);
  for (const v of list) if (typeof v !== "number") throw new RuntimeError(Codes.NativeListNumbers, i + 1);
  return list as number[];
}

function statsSum(...args: unknown[]): unknown {
  exactly(args, 1);
  let total = 0;
  for (const x of numbersArg(args, 0)) total += x;
  return finite(total);
}

function extreme(better: (a: number, b: number) => boolean): Impl {
  return (...args) => {
    exactly(args, 1);
    const xs = numbersArg(args, 0);
    if (xs.length === 0) throw new RuntimeError(Codes.StatsNotEnough);
    let best = xs[0];
    for (const x of xs.slice(1)) if (better(x, best)) best = x;
    return clean(best);
  };
}

function meanOf(xs: number[]): number {
  let total = 0;
  for (const x of xs) total += x;
  return total / xs.length;
}

function statsMean(...args: unknown[]): unknown {
  exactly(args, 1);
  const xs = numbersArg(args, 0);
  if (xs.length === 0) throw new RuntimeError(Codes.StatsNotEnough);
  return finite(meanOf(xs));
}

function statsMedian(...args: unknown[]): unknown {
  exactly(args, 1);
  const xs = numbersArg(args, 0).slice().sort((a, b) => a - b);
  if (xs.length === 0) throw new RuntimeError(Codes.StatsNotEnough);
  const mid = Math.floor(xs.length / 2);
  if (xs.length % 2 === 1) return clean(xs[mid]);
  return finite((xs[mid - 1] + xs[mid]) / 2);
}

function statsStdev(...args: unknown[]): unknown {
  exactly(args, 1);
  const xs = numbersArg(args, 0);
  if (xs.length < 2) throw new RuntimeError(Codes.StatsNotEnough);
  const m = meanOf(xs);
  let sum = 0;
  for (const x of xs) {
    const d = x - m;
    sum += d * d;
  }
  return finite(Math.sqrt(sum / (xs.length - 1)));
}

// ---- text (lengths and positions count code points)

const MAX_RESULT = 1_000_000;
const codePoints = (s: string) => Array.from(s);

function textFunc1(f: (s: string) => string): Impl {
  return (...args) => {
    exactly(args, 1);
    return f(stringArg(args, 0));
  };
}

// Case changes go one character at a time and keep a character whose upper/lower
// form is more than one character (like the German sharp s), as Go does.
function mapCase(s: string, f: (c: string) => string): string {
  return codePoints(s)
    .map((c) => {
      const m = f(c);
      return codePoints(m).length === 1 ? m : c;
    })
    .join("");
}

const STRIP_SET = new Set([" ", "\t", "\n", "\v", "\f", "\r", " ", "　"]);

function stripText(s: string): string {
  const cs = codePoints(s);
  let a = 0;
  let b = cs.length;
  while (a < b && STRIP_SET.has(cs[a])) a++;
  while (b > a && STRIP_SET.has(cs[b - 1])) b--;
  return cs.slice(a, b).join("");
}

function padFiller(args: unknown[]): [string, string] {
  exactly(args, 3);
  const text = stringArg(args, 0);
  const width = integerArg(args, 1);
  const fill = stringArg(args, 2);
  if (codePoints(fill).length !== 1) throw new RuntimeError(Codes.PadFillLength);
  if (width < 0 || width > MAX_RESULT) throw new RuntimeError(Codes.ResultTooLarge);
  return [text, fill.repeat(Math.max(0, width - codePoints(text).length))];
}

function textRepeat(...args: unknown[]): unknown {
  exactly(args, 2);
  const text = stringArg(args, 0);
  const n = integerArg(args, 1);
  if (n < 0) throw new RuntimeError(Codes.NativeArgInteger, 2);
  if (codePoints(text).length * n > MAX_RESULT) throw new RuntimeError(Codes.ResultTooLarge);
  return text.repeat(n);
}

function twoStrings(args: unknown[]): [string, string] {
  exactly(args, 2);
  return [stringArg(args, 0), stringArg(args, 1)];
}

function textJoin(...args: unknown[]): unknown {
  exactly(args, 2);
  const list = listArg(args, 0);
  const sep = stringArg(args, 1);
  for (const v of list) if (typeof v !== "string") throw new RuntimeError(Codes.NativeListStrings, 1);
  return (list as string[]).join(sep);
}

function textCount(...args: unknown[]): unknown {
  const [text, part] = twoStrings(args);
  if (part === "") throw new RuntimeError(Codes.TextEmptyPart);
  let count = 0;
  for (let i = text.indexOf(part); i >= 0; i = text.indexOf(part, i + part.length)) count++;
  return count;
}

function textFind(...args: unknown[]): unknown {
  const [text, part] = twoStrings(args);
  if (part === "") throw new RuntimeError(Codes.TextEmptyPart);
  const i = text.indexOf(part);
  return i < 0 ? null : codePoints(text.slice(0, i)).length + 1;
}

// ---- list

function listSort(...args: unknown[]): unknown {
  exactly(args, 1);
  const out = listArg(args, 0).slice();
  if (out.length === 0) return out;
  if (typeof out[0] === "number") {
    if (!out.every((v) => typeof v === "number")) throw new RuntimeError(Codes.ListNotSortable);
    return (out as number[]).sort((a, b) => a - b).map(clean);
  }
  if (typeof out[0] === "string") {
    if (!out.every((v) => typeof v === "string")) throw new RuntimeError(Codes.ListNotSortable);
    return (out as string[]).sort(compareBytes);
  }
  throw new RuntimeError(Codes.ListNotSortable);
}

function listReverse(...args: unknown[]): unknown {
  exactly(args, 1);
  return listArg(args, 0).slice().reverse();
}

function listUnique(...args: unknown[]): unknown {
  exactly(args, 1);
  const seen = new Set<unknown>();
  const out: unknown[] = [];
  for (const raw of listArg(args, 0)) {
    const v = raw === undefined ? null : raw;
    if (v !== null && typeof v !== "boolean" && typeof v !== "number" && typeof v !== "string") {
      throw new RuntimeError(Codes.ListValueUnsupported);
    }
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function listRange(...args: unknown[]): unknown {
  between(args, 2, 3);
  const start = integerArg(args, 0);
  const end = integerArg(args, 1);
  let step = start > end ? -1 : 1;
  if (args.length === 3) {
    step = integerArg(args, 2);
    if (step === 0) throw new RuntimeError(Codes.RangeStepZero);
  }
  if ((step > 0 && start > end) || (step < 0 && start < end)) return [];
  const count = Math.trunc((end - start) / step) + 1;
  if (count > MAX_RESULT) throw new RuntimeError(Codes.ResultTooLarge);
  const out: number[] = [];
  for (let n = 0; n < count; n++) out.push(start + n * step);
  return out;
}

function listFlatten(...args: unknown[]): unknown {
  exactly(args, 1);
  const out: unknown[] = [];
  for (const v of listArg(args, 0)) {
    if (Array.isArray(v)) out.push(...v);
    else out.push(v);
  }
  return out;
}

function listChunk(...args: unknown[]): unknown {
  exactly(args, 2);
  const list = listArg(args, 0);
  const n = integerArg(args, 1);
  if (n < 1) throw new RuntimeError(Codes.NativeArgInteger, 2);
  const out: unknown[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

function listZip(...args: unknown[]): unknown {
  exactly(args, 2);
  const a = listArg(args, 0);
  const b = listArg(args, 1);
  const n = Math.min(a.length, b.length);
  const out: unknown[][] = [];
  for (let i = 0; i < n; i++) out.push([a[i], b[i]]);
  return out;
}

// ---- encoding and hash (the text is UTF-8; these work on its bytes)

const utf8 = new TextEncoder();

function base64Encode(...args: unknown[]): unknown {
  exactly(args, 1);
  let binary = "";
  for (const b of utf8.encode(stringArg(args, 0))) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64Decode(...args: unknown[]): unknown {
  exactly(args, 1);
  const s = stringArg(args, 0);
  if (s.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw new RuntimeError(Codes.Base64Invalid);
  try {
    const binary = atob(s);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new RuntimeError(Codes.Base64Invalid);
  }
}

const isUnreserved = (b: number) =>
  (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a) || (b >= 0x30 && b <= 0x39) || b === 0x2d || b === 0x5f || b === 0x2e || b === 0x7e;

function urlEncode(...args: unknown[]): unknown {
  exactly(args, 1);
  let out = "";
  for (const b of utf8.encode(stringArg(args, 0))) {
    out += isUnreserved(b) ? String.fromCharCode(b) : "%" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

function urlDecode(...args: unknown[]): unknown {
  exactly(args, 1);
  const s = stringArg(args, 0);
  const bytes: number[] = [];
  for (let i = 0; i < s.length; ) {
    const ch = String.fromCodePoint(s.codePointAt(i)!);
    if (ch !== "%") {
      bytes.push(...utf8.encode(ch));
      i += ch.length;
      continue;
    }
    const hex = s.slice(i + 1, i + 3);
    if (!/^[0-9A-Fa-f]{2}$/.test(hex)) throw new RuntimeError(Codes.URLDecodeInvalid);
    bytes.push(parseInt(hex, 16));
    i += 3;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    throw new RuntimeError(Codes.URLDecodeInvalid);
  }
}

const SHA_K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
const SHA_H0 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

function sha256Hex(data: Uint8Array): string {
  const padded = new Uint8Array(Math.ceil((data.length + 9) / 64) * 64);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor((data.length * 8) / 0x100000000));
  view.setUint32(padded.length - 4, (data.length * 8) >>> 0);
  const h = SHA_H0.slice();
  const w = new Array<number>(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + SHA_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, hh].forEach((v, i) => (h[i] = (h[i] + v) >>> 0));
  }
  return h.map((v) => v.toString(16).padStart(8, "0")).join("");
}

function hashSHA256(...args: unknown[]): unknown {
  exactly(args, 1);
  return sha256Hex(utf8.encode(stringArg(args, 0)));
}

function randomUUID(...args: unknown[]): unknown {
  exactly(args, 0);
  const b = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.map((v) => v.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
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
  "datetime.weekday": datetimeWeekday,

  "math.sqrt": oneNumber(Math.sqrt),
  "math.pow": mathPow,
  "math.abs": oneNumber(Math.abs),
  "math.round": mathRound,
  "math.sin": oneNumber(Math.sin),
  "math.cos": oneNumber(Math.cos),
  "math.tan": oneNumber(Math.tan),
  "math.log": mathLog,
  "math.pi": mathPi,
  "math.gcd": mathGcd,
  "math.factorial": mathFactorial,

  "stats.sum": statsSum,
  "stats.min": extreme((a, b) => a < b),
  "stats.max": extreme((a, b) => a > b),
  "stats.mean": statsMean,
  "stats.median": statsMedian,
  "stats.stdev": statsStdev,

  "text.upper": textFunc1((s) => mapCase(s, (c) => c.toUpperCase())),
  "text.lower": textFunc1((s) => mapCase(s, (c) => c.toLowerCase())),
  "text.strip": textFunc1(stripText),
  "text.padleft": (...args) => {
    const [text, filler] = padFiller(args);
    return filler + text;
  },
  "text.padright": (...args) => {
    const [text, filler] = padFiller(args);
    return text + filler;
  },
  "text.repeat": textRepeat,
  "text.reverse": textFunc1((s) => codePoints(s).reverse().join("")),
  "text.startswith": (...args) => {
    const [text, part] = twoStrings(args);
    return text.startsWith(part);
  },
  "text.endswith": (...args) => {
    const [text, part] = twoStrings(args);
    return text.endsWith(part);
  },
  "text.join": textJoin,
  "text.count": textCount,
  "text.find": textFind,

  "list.sort": listSort,
  "list.reverse": listReverse,
  "list.unique": listUnique,
  "list.range": listRange,
  "list.flatten": listFlatten,
  "list.chunk": listChunk,
  "list.zip": listZip,

  "encoding.base64encode": base64Encode,
  "encoding.base64decode": base64Decode,
  "encoding.urlencode": urlEncode,
  "encoding.urldecode": urlDecode,

  "hash.sha256": hashSHA256,
  "random.uuid": randomUUID,

  "regex.test": regexTest,
  "regex.find": regexFind,
  "regex.groups": regexGroups,
  "regex.findall": regexFindAll,
  "regex.replace": regexReplace,
  "regex.split": regexSplit,
};
