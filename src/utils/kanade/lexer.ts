// Mirrors hana/lexer/kanade/lexer.go: same ordered {kind, regex}[] spec
// table + indent stack shape as haja-docs' lexer.ts, but matched against
// Japanese full-width punctuation and vocabulary instead of Korean/ASCII —
// the regexes here are lifted verbatim from the Go source, which is itself
// already verified against every real kanade-docs code block (see
// hana/CLAUDE.md for the story of why an earlier ASCII-punctuation version
// didn't match anything real).
import * as tok from "./token";
import type { Token, TokenType } from "./token";

interface Spec {
  kind: TokenType | "SPACE";
  regex: RegExp;
}

// jaWord matches an identifier made of Korean/Latin/digit characters (kept
// for mixed-script identifiers) plus hiragana/katakana/kanji. It must not
// include any of the full-width delimiter characters below
// (「」『』【】〈〉), which it doesn't.
const JA_WORD = "[가-힣a-zA-Zぁ-んァ-ヶ一-龯ー_][가-힣a-zA-Zぁ-んァ-ヶ一-龯ー0-9_]*";

const SPECS: Spec[] = [
  // TEMPLATE_STRING must be tried before STRING/bare-枠 so "枠「...」" isn't
  // lexed as a bare IDENT "枠" + STRING.
  { kind: tok.TEMPLATE_STRING, regex: new RegExp('^枠「(?:\\{[^{}]*\\}|\\\\[\\s\\S]|[^」\\\\{])*」') },
  { kind: tok.STRING, regex: new RegExp('^「(?:\\\\[\\s\\S]|[^」\\\\])*」') },
  { kind: tok.VAR, regex: new RegExp("^『" + JA_WORD + "』") },
  { kind: tok.FUNCTION, regex: /^〈[^〉]+〉/ },
  // TYPE: 【(genericArgs)Name】 — generic arg list keeps ASCII parens
  // (kanade-docs: 【(文字列)リスト】, 【(文字列,数字)辞書】).
  { kind: tok.TYPE, regex: new RegExp("^【(?:\\([^)]+\\))?" + JA_WORD + "】") },
  // List/type brackets share 【】 in kanade-docs — TYPE above only matches
  // when the contents look like a type name, so a list literal like
  // 【「りんご」,「バナナ」】 falls through to bare LBRACKET here.
  { kind: tok.LBRACKET, regex: /^【/ },
  { kind: tok.RBRACKET, regex: /^】/ },
  { kind: tok.LPAREN, regex: /^\(/ },
  { kind: tok.RPAREN, regex: /^\)/ },
  { kind: tok.LBRACE, regex: /^\{/ },
  { kind: tok.RBRACE, regex: /^\}/ },
  { kind: tok.COMMA, regex: /^[,、]/ },
  { kind: tok.COLON, regex: /^:/ },
  { kind: tok.KW_RETURN, regex: /^返そう/ },
  { kind: tok.KW_BREAK, regex: /^繰り返しを終わろう/ },
  // Loop kind is fused into the verb itself (not a trailing marker word like
  // 하자's "동안"): unspaced Japanese text means a bare marker word right
  // before a bare loop verb would get swallowed into one IDENT token.
  { kind: tok.KW_LOOP, regex: /^ごとに繰り返そう|^間繰り返そう|^まで繰り返そう/ },
  { kind: tok.KW_PUSH, regex: /^追加しよう/ },
  // KW_FRONT/KW_BACK include a "…から" form (前から/後ろから/後から) fused as
  // one token: kanade-docs writes the popped-value-expression form with
  // "から" glued on, and splitting it off as a separate KW_FROM token would
  // make the parser's (FRONT|BACK)+POPPED lookahead miss it.
  { kind: tok.KW_POP, regex: /^取り出そう/ },
  { kind: tok.KW_POPPED, regex: /^取り出した/ },
  { kind: tok.KW_TRY, regex: /^とりあえずやってみよう/ },
  { kind: tok.KW_CATCH, regex: /^発生したら|^発生したなら/ },
  { kind: tok.KW_FINALLY, regex: /^最後はいつも|^締めくくりはいつも/ },
  { kind: tok.KW_THROW, regex: /^発生させよう/ },
  { kind: tok.KW_CLASS, regex: /^設計しよう|^下設計しよう/ },
  { kind: tok.KW_INTERFACE, regex: /^規定しよう/ },
  { kind: tok.KW_MUST_HAVE, regex: /^なければならない/ },
  { kind: tok.KW_IMPORT, regex: /^持ってこよう/ },
  { kind: tok.KW_FROM, regex: /^から/ },
  { kind: tok.KW_IMPLEMENTS, regex: /^従う/ },
  // もしくは(なら(ば)?) doubles as "else if" (KW_ELIF) — must be checked
  // before bare KW_IF ("もし"), which is a prefix of "もしくは" and would
  // otherwise steal the first two characters and leave "くは" dangling.
  { kind: tok.KW_ELIF, regex: /^もしくは/ },
  { kind: tok.KW_IF, regex: /^もし/ },
  { kind: tok.KW_ELSE, regex: /^それ以外ならば|^それ以外なら|^それ以外で/ },
  { kind: tok.IDENT, regex: /^ならば|^なら/ },
  // "値" (PoppedValueWord) needs its own early match: unspaced Japanese
  // means "値にしよう" would otherwise fall through to the generic IDENT
  // catch-all and get swallowed whole (value+verb as one token).
  { kind: tok.IDENT, regex: /^値/ },
  { kind: tok.KW_MAKE, regex: /^作って隠そう|^作って譲ろう|^作ろう|^にしよう|^固定しよう|^隠そう|^譲ろう|^準備しよう/ },
  { kind: tok.KW_PRINT, regex: /^続けて出力しよう|^出力しよう/ },
  { kind: tok.KW_INPUT, regex: /^入力させよう|^入力してもらおう/ },
  { kind: tok.KW_EXECUTE, regex: /^実行しよう/ },
  { kind: tok.KW_NULL, regex: /^空っぽ/ },
  { kind: tok.KW_TRUE, regex: /^真/ },
  { kind: tok.KW_FALSE, regex: /^偽/ },
  { kind: tok.KW_CONSTRUCT, regex: /^最初に作られる時/ },
  { kind: tok.KW_DO_AS, regex: /^次のようにしよう/ },
  { kind: tok.KW_BASE, regex: /^基づいて|^もとにして/ },
  { kind: tok.KW_GETTER, regex: /^取得する時/ },
  { kind: tok.KW_SETTER, regex: /^決める時/ },
  { kind: tok.KW_PARENT, regex: /^親/ },
  { kind: tok.KW_OUTER, regex: /^外/ },
  { kind: tok.KW_NEW, regex: /^新しい/ },
  { kind: tok.KW_SWITCH, regex: /^によって分けよう/ },
  { kind: tok.KW_CASE, regex: /^の場合/ },
  { kind: tok.KW_DEFAULT, regex: /^残りは/ },
  { kind: tok.KW_FALLTHROUGH, regex: /^次に続けよう/ },
  { kind: tok.KW_AND, regex: /^かつ|^そして/ },
  // "もしくは" is KW_ELIF only (checked earlier above) — not repeated here.
  { kind: tok.KW_OR, regex: /^または/ },
  { kind: tok.KW_SELF, regex: /^私/ },
  { kind: tok.KW_FRONT, regex: /^前から|^前で|^前に|^前/ },
  { kind: tok.KW_BACK, regex: /^後ろから|^後ろで|^後ろに|^後から|^後で|^後に|^後/ },
  { kind: tok.KW_ADD, regex: /^足そう/ },
  { kind: tok.KW_SUB, regex: /^引こう/ },
  {
    kind: tok.COMPARE,
    regex:
      /^(==|!=|<=|>=|<|>|と同じだ|と同じ|と等しい|より大きい|より小さい|以上だ|以下だ|以上|以下|の一種だ|の一種|一種だ|一種|同じだ|同じ|等しい|異なる|違う|小さい|大きい)/,
  },
  { kind: tok.ASSIGN, regex: /^=/ },
  { kind: tok.OP, regex: /^[+\-*/%]/ },
  // TYPE_IN has no dedicated regex here: kanade-docs reuses "の" for it
  // (【数字】の0), the same word as member access — parser.ts's TYPE_IN
  // checks already fall back to comparing a PARTICLE's literal against
  // langProfile.typeInWord, so a bare PARTICLE "の" is enough.
  { kind: tok.PARTICLE, regex: /^(を|に|で|は|が|の|と|も|から|へ|より|くらい|まで|ずつ|など|番目)/ },
  { kind: tok.INT, regex: /^\d+(?:\.\d+)?/ },
  { kind: tok.IDENT, regex: new RegExp("^" + JA_WORD) },
  { kind: "SPACE", regex: /^[ \t　]+/ },
];

export class Lexer {
  tokens: Token[] = [];

  constructor(input: string) {
    this.tokenize(input);
  }

  private tokenize(input: string): void {
    const lines = input.split("\n");
    const indents = [0];
    let lineNum = 1;

    for (let rawLine of lines) {
      // kanade-docs' actual comment marker is "(参考...)" — either "(参考)"
      // (rest of line is prose) or "(参考:...)" (colon then note).
      const refIdx = rawLine.indexOf("(参考)");
      if (refIdx !== -1) rawLine = rawLine.slice(0, refIdx);
      const refColonIdx = rawLine.indexOf("(参考:");
      if (refColonIdx !== -1) rawLine = rawLine.slice(0, refColonIdx);

      if (rawLine.trim() === "") {
        lineNum++;
        continue;
      }

      const indentMatch = /^[ \t]*/.exec(rawLine)?.[0] ?? "";
      const currentIndent = indentMatch.length;

      if (currentIndent > indents[indents.length - 1]) {
        indents.push(currentIndent);
        this.tokens.push({ type: tok.INDENT, literal: "", line: lineNum, col: 0 });
      } else if (currentIndent < indents[indents.length - 1]) {
        while (currentIndent < indents[indents.length - 1]) {
          indents.pop();
          this.tokens.push({ type: tok.DEDENT, literal: "", line: lineNum, col: 0 });
        }
      }

      let remaining = rawLine.trim();
      let col = currentIndent;

      while (remaining.length > 0) {
        let matched = false;
        for (const spec of SPECS) {
          const m = spec.regex.exec(remaining);
          if (m && m.index === 0) {
            const val = m[0];
            if (spec.kind !== "SPACE") {
              this.tokens.push({ type: spec.kind, literal: val, line: lineNum, col });
            }
            remaining = remaining.slice(val.length);
            col += val.length;
            matched = true;
            break;
          }
        }
        if (!matched) {
          // No rule accepts this character: keep it as an ILLEGAL token so the
          // parser reports it (same as hana's lexers).
          const ch = String.fromCodePoint(remaining.codePointAt(0)!);
          this.tokens.push({ type: tok.ILLEGAL, literal: ch, line: lineNum, col });
          remaining = remaining.slice(ch.length);
          col += ch.length;
        }
      }
      lineNum++;
    }

    while (indents.length > 1) {
      indents.pop();
      this.tokens.push({ type: tok.DEDENT, literal: "", line: lineNum, col: 0 });
    }
    this.tokens.push({ type: tok.EOF, literal: "", line: lineNum, col: 0 });
  }
}
