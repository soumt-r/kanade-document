// CodeMirror 6 language-service glue for the Playground editor: autocomplete
// + a linter that re-runs the real Lexer/Parser on every doc change purely
// to catch thrown errors and turn them into Diagnostics. Renamed from the
// previous ad hoc engine's `hajaLSP.ts` (a copy-paste leftover filename from
// forking haja-docs — playground.astro's import path is updated to match).
import { autocompletion } from "@codemirror/autocomplete";
import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { linter } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";
import type { Diagnostic } from "@codemirror/lint";
import { Lexer } from "./lexer";
import { Parser } from "./parser";
import { JapaneseConfig } from "./config";
import { message, syntaxError } from "./errs";

const keywords = [
  "真", "偽", "空っぽ", "設計しよう", "規定しよう", "なければならない", "最初に作られる時",
  "次のようにしよう", "基づいて", "もとにして", "従う", "取得する時", "決める時",
  "作ろう", "隠そう", "譲ろう", "にしよう", "固定しよう", "準備しよう",
  "返す", "返そう", "出力しよう", "続けて出力しよう", "入力させよう", "実行しよう",
  "とりあえずやってみよう", "発生したら", "発生したなら", "最後はいつも", "発生させよう",
  "もし", "もしくは", "それ以外なら", "なら", "ならば", "によって分けよう", "の場合", "残りは", "次に続けよう",
  "間繰り返そう", "ごとに繰り返そう", "から", "まで繰り返そう", "繰り返しを終わろう",
  "追加しよう", "取り出そう", "同じだ", "違う", "かつ", "そして", "または",
  "持ってこよう", "全部", "値", "長さ", "前", "後", "親", "外", "新しい", "私", "私たち",
];

export function kanadeCompletions(context: CompletionContext): CompletionResult | null {
  let word = context.matchBefore(/[ぁ-んァ-ン一-龥ーa-zA-Z_]+/);
  let isVar = false;
  let isType = false;
  let isProp = false;
  let needsPrefixSpace = false;

  const varMatch = context.matchBefore(/『[ぁ-んァ-ン一-龥ーa-zA-Z_]*/);
  const typeMatch = context.matchBefore(/【[ぁ-んァ-ン一-龥ーa-zA-Z_]*/);
  const propMatch = context.matchBefore(/〈[ぁ-んァ-ン一-龥ーa-zA-Z_]*/);
  const particleMatch = context.matchBefore(/の\s*$/);

  if (varMatch && (!word || varMatch.from < word.from)) {
    word = varMatch;
    isVar = true;
  } else if (typeMatch && (!word || typeMatch.from < word.from)) {
    word = typeMatch;
    isType = true;
  } else if (propMatch && (!word || propMatch.from < word.from)) {
    word = propMatch;
    isProp = true;
  } else if (particleMatch) {
    word = { from: context.pos, to: context.pos, text: "" };
    isProp = true;
    isVar = true;
    if (!/\s$/.test(particleMatch.text)) needsPrefixSpace = true;
  }

  if (!word) return null;
  if (word.from === word.to && !context.explicit && !particleMatch) return null;

  const doc = context.state.doc.toString();
  const options: any[] = [];
  const seen = new Set<string>();

  if (!isVar && !isType && !isProp) {
    for (const kw of keywords) {
      let applyStr = kw;
      if (["もし", "もしくは", "それ以外なら"].includes(kw)) {
        applyStr = kw + " ";
      } else if (["設計しよう", "とりあえずやってみよう", "最後はいつも"].includes(kw)) {
        applyStr = kw + ":\n    ";
      }
      options.push({ label: kw, type: "keyword", apply: applyStr });
      seen.add(kw);
    }
  }

  let tokens: any[] = [];
  try {
    const lexer = new Lexer(doc);
    tokens = lexer.tokens;
  } catch {
    // 자동완성이니 파싱 실패는 조용히 무시한다
  }
  void tokens;

  const varRegex = /『([ぁ-んァ-ン一-龥ーa-zA-Z0-9_]+)』/g;
  const typeRegex = /【([ぁ-んァ-ン一-龥ーa-zA-Z0-9_]+)】/g;
  const propRegex = /〈([ぁ-んァ-ン一-龥ーa-zA-Z0-9_]+)〉/g;

  let match;
  while ((match = varRegex.exec(doc)) !== null) {
    const val = "『" + match[1] + "』";
    if (!seen.has(val)) {
      seen.add(val);
      if (isVar || (!isType && !isProp)) options.push({ label: val, type: "variable", apply: (needsPrefixSpace ? " " : "") + val });
    }
  }
  while ((match = typeRegex.exec(doc)) !== null) {
    const val = "【" + match[1] + "】";
    if (!seen.has(val)) {
      seen.add(val);
      if (isType || (!isVar && !isProp)) options.push({ label: val, type: "class", apply: (needsPrefixSpace ? " " : "") + val });
    }
  }
  while ((match = propRegex.exec(doc)) !== null) {
    const val = "〈" + match[1] + "〉";
    if (!seen.has(val)) {
      seen.add(val);
      if (isProp || (!isVar && !isType)) options.push({ label: val, type: "method", apply: (needsPrefixSpace ? " " : "") + val });
    }
  }

  if (isProp || isVar) {
    const builtins = ["〈切り取り〉", "〈入れ替え〉", "〈分割〉", "〈含むか確認〉", "〈追加しよう〉", "〈空にする〉"];
    for (const b of builtins) {
      if (!seen.has(b)) {
        seen.add(b);
        if (isProp) options.push({ label: b, type: "method", apply: (needsPrefixSpace ? " " : "") + b });
      }
    }
    if (isVar) {
      if (!seen.has("『長さ』")) {
        seen.add("『長さ』");
        options.push({ label: "『長さ』", type: "variable", apply: (needsPrefixSpace ? " " : "") + "『長さ』" });
      }
    }
  }

  if (isType) {
    const builtins = ["【文字列】", "【数字】", "【論理】"];
    for (const b of builtins) {
      if (!seen.has(b)) {
        seen.add(b);
        options.push({ label: b, type: "type", apply: (needsPrefixSpace ? " " : "") + b });
      }
    }
  }

  return {
    from: word.from,
    options: options,
  };
}

export const kanadeAutocomplete = autocompletion({ override: [kanadeCompletions] });

export const kanadeLintSource = (view: EditorView): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  const doc = view.state.doc.toString();

  if (!doc.trim()) return diagnostics;

  try {
    const lexer = new Lexer(doc);
    const parser = new Parser(lexer.tokens);
    parser.parseProgram();
    // The parser recovers from bad tokens, so it reports them as diagnostics
    // (same wording as hana's LSP and CLI, from the shared error catalog).
    for (const d of parser.diagnostics) {
      const line = Math.min(Math.max(d.line, 1), view.state.doc.lines);
      const info = view.state.doc.line(line);
      // Running off the end (empty literal) has no token: mark the line's last character.
      const from = d.literal === "" ? Math.max(info.to - 1, info.from) : Math.min(info.from + d.col, info.to);
      const to = d.literal === "" ? info.to : Math.min(from + Math.max(d.literal.length, 1), info.to);
      diagnostics.push({
        from,
        to: Math.max(to, from),
        severity: "error",
        message: message(JapaneseConfig.locale, syntaxError(d)),
      });
    }
  } catch (err: any) {
    const msg = String(err);
    // KanadeError の message は "N行目、N文字目: ..." 形式(errors.ts 参照)。
    const match = msg.match(/(\d+)行目(?:、\s*(\d+)文字目)?/);
    if (match) {
      let line = parseInt(match[1], 10);
      if (line < 1) line = 1;
      if (line > view.state.doc.lines) line = view.state.doc.lines;

      const col = match[2] ? parseInt(match[2], 10) : 0;
      const lineInfo = view.state.doc.line(line);
      const from = Math.min(lineInfo.from + col, lineInfo.to);
      const to = lineInfo.to;

      diagnostics.push({
        from,
        to: Math.max(from + 1, to),
        severity: "error",
        message: msg,
      });
    } else {
      diagnostics.push({
        from: 0,
        to: view.state.doc.line(1).to,
        severity: "error",
        message: msg,
      });
    }
  }

  return diagnostics;
};

export const kanadeLinter = linter(kanadeLintSource);
