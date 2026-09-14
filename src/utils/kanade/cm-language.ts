import { StreamLanguage, type StreamParser } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

const kanadeParser: StreamParser<unknown> = {
  token(stream) {
    if (stream.eatSpace()) return null;

    if (stream.match(/^\d+(?:\.\d+)?/)) return "number";
    if (stream.match(/^「(?:\\[\s\S]|[^"\\])*」/)) return "string";
    if (stream.match(/^枠「(?:\{[^{}]*\}|\\[\s\S]|[^"\\{])*」/)) return "string";
    if (stream.match(/^【[^】]+】/)) return "typeName";
    if (stream.match(/^〈[^〉]+〉/)) return "propertyName";
    if (stream.match(/^『[가-힣a-zA-Z0-9_ぁ-んァ-ン一-龥]+』/)) return "variableName";
    
    // Comments
    if (stream.match(/^\/\/.*/)) return "comment";
    if (stream.match(/^\(?(参考|注釈|メモ)(:|\)| ).*/)) return "comment";

    const keywordRegex = /^(設計しよう|下設計しよう|規定しよう|なければならない|最初に作られる時|次のようにしよう|基づいて|もとにして|従う|取得する時|決める時|作ろう|作って隠そう|作って受け継ごう|隠そう|受け継ごう|にしよう|固定しよう|準備しよう|返す|返そう|続けて出力しよう|出力しよう|入力させよう|実行しよう|とりあえずやってみよう|エラーが発生したら|発生したら|最後はいつも|発生させよう|もし|もしくは|それ以外なら|ならば|なら|によって分けよう|の場合|残りは|次に続けよう|間繰り返そう|ごとに繰り返そう|から|まで繰り返そう|繰り返しを終わろう|持ってこよう|全部|値|番目の値|番目|長さ|親|外|新しい|私|そして|または|前で|前に|前|後で|後に|後|足そう|引こう|追加しよう|取り出した|取り出そう)/;
    if (stream.match(keywordRegex)) return "keyword";

    const operatorRegex = /^[+\-*/%=!:,]/;
    if (stream.match(operatorRegex)) return "operator";

    const particles = /^(から|へ|より|くらい|を|に|で|は|が|の|と|も)/;
    if (stream.match(particles)) return "propertyName"; 

    const booleanNull = /^(真|偽|空っぽ)/;
    if (stream.match(booleanNull)) return "bool";

    stream.next();
    return null;
  }
};

export const kanadeLanguage = StreamLanguage.define(kanadeParser);
