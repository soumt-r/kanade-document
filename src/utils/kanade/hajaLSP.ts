import { autocompletion } from "@codemirror/autocomplete";
import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { linter } from "@codemirror/lint";
import type { Diagnostic } from "@codemirror/lint";
import { Lexer } from "./lexer";
import { Parser } from "./parser";

const keywords = [
  "真", "偽", "空っぽ", "設計しよう", "規定しよう", "なければならない", "最初に作られる時",
  "次のようにしよう", "基づいて", "もとにして", "従う", "取得する時", "決める時",
  "作ろう", "隠そう", "受け継ごう", "にしよう", "固定しよう", "準備しよう",
  "返す", "返そう", "出力しよう", "入力させよう", "実行しよう",
  "とりあえずやってみよう", "発生したら", "エラーが発生したら", "最後はいつも", "発生させよう",
  "もし", "もしくは", "それ以外なら", "なら", "ならば", "によって分けよう", "の場合", "残りは", "次に続けよう",
  "間繰り返そう", "ごとに繰り返そう", "から", "まで繰り返そう", "繰り返しを終わろう",
  "持ってこよう", "全部", "値", "長さ", "親", "外", "新しい", "私"
];

export function hajaCompletions(context: CompletionContext): CompletionResult | null {
  let word = context.matchBefore(/[ぁ-んァ-ン一-龥ーa-zA-Z_]+/);
  let isVar = false;
  let isType = false;
  let isProp = false;
  let needsPrefixSpace = false;

  const varMatch = context.matchBefore(/『[ぁ-んァ-ン一-龥ーa-zA-Z_]*/);
  const typeMatch = context.matchBefore(/【[ぁ-んァ-ン一-龥ーa-zA-Z_]*/);
  const propMatch = context.matchBefore(/〈[ぁ-んァ-ン一-龥ーa-zA-Z_]*/);
  const particleMatch = context.matchBefore(/の\s*$/);

  if (varMatch && (!word || varMatch.from < word.from)) { word = varMatch; isVar = true; }
  else if (typeMatch && (!word || typeMatch.from < word.from)) { word = typeMatch; isType = true; }
  else if (propMatch && (!word || propMatch.from < word.from)) { word = propMatch; isProp = true; }
  else if (!word) return null;

  if (word && word.from > 0) {
    const prevChar = context.state.sliceDoc(word.from - 1, word.from);
    if (![" ", "　", "\n", "【", "】", "『", "』", "「", "」", "〈", "〉", ":", "(", ")"].includes(prevChar)) {
      if (particleMatch && particleMatch.from === word.from - particleMatch.text.length) {
        // Particle match
      }
    }
  }

  const options: any[] = [];
  const seen = new Set<string>();

  if (!isVar && !isType && !isProp) {
    for (const kw of keywords) {
      let applyStr = kw;
      if (["もし", "もしくは", "それ以外なら"].includes(kw)) {
        applyStr = kw + " ";
      }
      options.push({ label: kw, type: "keyword", apply: (needsPrefixSpace ? " " : "") + applyStr });
      seen.add(kw);
    }
  }

  try {
    const text = context.state.doc.toString();
    const lexer = new Lexer(text);
    const parser = new Parser(lexer.tokens);
    const ast = parser.parse_program();

    const walk = (node: any) => {
      if (!node) return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }

      if (node.type === "VariableDeclaration" && node.target) {
        if (node.target.type === "Identifier" && node.target.name) {
          const v = `『${node.target.name}』`;
          if (!seen.has(v) && isVar) {
            seen.add(v);
            options.push({ label: v, type: "variable", apply: (needsPrefixSpace ? " " : "") + v });
          }
        }
      }
      if (node.type === "ClassDeclaration") {
        const t = `【${node.id}】`;
        if (!seen.has(t) && isType) {
          seen.add(t);
          options.push({ label: t, type: "type", apply: (needsPrefixSpace ? " " : "") + t });
        }
      }
      if (node.type === "FunctionDeclaration") {
        const p = `〈${node.id}〉`;
        if (!seen.has(p) && isProp) {
          seen.add(p);
          options.push({ label: p, type: "property", apply: (needsPrefixSpace ? " " : "") + p });
        }
      }
      
      for (const key in node) {
        if (typeof node[key] === 'object') walk(node[key]);
      }
    };
    walk(ast);

    if (isType) {
      const builtins = ["【文字】", "【数字】", "【真偽】"];
      for (const b of builtins) {
        if (!seen.has(b)) {
          seen.add(b);
          options.push({ label: b, type: "type", apply: (needsPrefixSpace ? " " : "") + b });
        }
      }
    }

    if (isProp || isVar) {
      const builtins = ["〈切り取る〉", "〈切り取り〉", "〈入れ替え〉", "〈変える〉", "〈分ける〉", "〈分割〉", "〈含むか確認〉", "〈追加する〉", "〈取り出す〉"];
      for (const b of builtins) {
        if (!seen.has(b)) {
          seen.add(b);
          options.push({ label: b, type: "property", apply: (needsPrefixSpace ? " " : "") + b });
        }
      }
      if (isVar) {
        if (!seen.has("『私』")) {
          seen.add("『私』");
          options.push({ label: "『私』", type: "variable", apply: (needsPrefixSpace ? " " : "") + "『私』" });
        }
      }
    }

  } catch (e) {
    // ignore parse errors for autocomplete
  }

  return {
    from: word.from,
    options: options
  };
}

export const hajaAutocomplete = autocompletion({ override: [hajaCompletions] });

export const hajaLinter = linter((view) => {
  const diagnostics: Diagnostic[] = [];
  const text = view.state.doc.toString();
  
  if (text.trim().length === 0) return diagnostics;

  try {
    const lexer = new Lexer(text);
    const parser = new Parser(lexer.tokens);
    parser.parse_program();
  } catch (err: any) {
    const msg = String(err);
    const match = msg.match(/line (\d+), col (\d+)/i) || msg.match(/(\d+)行目/);
    if (match) {
      let line = parseInt(match[1]);
      let col = match[2] ? parseInt(match[2]) : 0;
      const linePos = view.state.doc.line(line);
      const from = Math.min(linePos.from + col, linePos.to);
      diagnostics.push({
        from: from,
        to: linePos.to,
        severity: "error",
        message: msg
      });
    } else {
      diagnostics.push({
        from: 0,
        to: view.state.doc.length,
        severity: "error",
        message: msg
      });
    }
  }

  return diagnostics;
});
