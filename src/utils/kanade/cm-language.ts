import { StreamLanguage, type StreamParser } from "@codemirror/language";
import { lspKeywords } from "./lspKeywords";

// Verbs and words the lexer reads that lspKeywords (the editor's completion list,
// generated from hana/lsp) does not carry: verb variants, comparisons, and the
// loop/class phrases. Everything in lspKeywords is highlighted too, so a keyword
// added to hana shows up colored here without touching this file.
const extraKeywords = [
  "下設計しよう", "基づいて", "従う", "作って隠そう", "作って受け継ごう", "作って譲ろう", "隠そう", "受け継ごう", "準備しよう",
  "返す", "続けて出力しよう", "入力してもらおう", "エラーが発生したら", "エラーが発生したなら", "最後はいつも", "締めくくりはいつも",
  "もしくは", "それ以外で", "それ以外ならば", "ならば", "なら", "次に続けよう", "全部", "番目の値", "番目", "長さ", "私たち",
  "前で", "前に", "前から", "後で", "後に", "後から", "後ろで", "後ろに", "後ろから", "足そう", "引こう", "取り出した",
  "と同じだ", "と同じ", "と等しい", "より大きい", "より小さい", "以上だ", "以上", "以下だ", "以下", "の一種だ", "の一種", "一種だ", "一種",
  "同じだ", "同じ", "等しい", "異なる", "違う", "小さい", "大きい", "同じ",
];

const valueWords = ["真", "偽", "空っぽ"];

function alternation(words: readonly string[]): RegExp {
  const unique = Array.from(new Set(words)).sort((a, b) => b.length - a.length);
  const escaped = unique.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp("^(?:" + escaped.join("|") + ")");
}

const keywordRegex = alternation([
  ...lspKeywords.keywords.filter((w) => !valueWords.includes(w)),
  ...lspKeywords.comparisons,
  ...lspKeywords.words,
  ...extraKeywords,
]);
const valueRegex = alternation(valueWords);

const kanadeParser: StreamParser<unknown> = {
  token(stream) {
    if (stream.eatSpace()) return null;

    if (stream.match(/^\d+(?:\.\d+)?/)) return "number";
    if (stream.match(/^「(?:\\[\s\S]|[^」\\])*」/)) return "string";
    if (stream.match(/^枠「(?:\{[^{}]*\}|\\[\s\S]|[^」\\{])*」/)) return "string";
    if (stream.match(/^【[^】]+】/)) return "typeName";
    if (stream.match(/^〈[^〉]+〉/)) return "propertyName";
    if (stream.match(/^『[^』]+』/)) return "variableName";

    // 주석: `(参考)` 뒤나 `(参考:...)`부터 줄 끝까지 (렉서도 그렇게 자른다)
    if (stream.match(/^\/\/.*/)) return "comment";
    if (stream.match(/^\(?(参考|注釈|メモ)(:|\)| ).*/)) return "comment";

    if (stream.match(valueRegex)) return "bool";
    if (stream.match(keywordRegex)) return "keyword";

    if (stream.match(/^[+\-*/%=!:,]/)) return "operator";

    if (stream.match(/^(から|へ|より|くらい|を|に|で|は|が|の|と|も)/)) return "meta";

    if (stream.match(/^[(){}\[\]]/)) return "bracket";

    stream.next();
    return null;
  },
};

export const kanadeLanguage = StreamLanguage.define(kanadeParser);
