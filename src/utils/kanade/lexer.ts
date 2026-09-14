import { KanadeError, type Token } from './types';

export class Lexer {
  code: string;
  tokens: Token[];

  constructor(code: string) {
    this.code = code;
    this.tokens = [];
    this.tokenize();
  }

  tokenize() {
    const token_specification: [string, RegExp][] = [
      ['NUMBER',       /^\d+(?:\.\d+)?/],
      ['FORMAT_STR',   /^枠「(?:\{[^{}]*\}|\\[\s\S]|[^」\\{])*」/],
      ['STRING',       /^「(?:\\[\s\S]|[^」\\])*」/],
      ['TYPE',         /^【(?:\([^)]+\))?[가-힣a-zA-Z_ぁ-んァ-ン一-龥ー][가-힣a-zA-Z0-9_ぁ-んァ-ン一-龥ー]*】/],
      ['EMPTY_LIST',   /^【】/],
      ['LBRACKET',     /^【/],
      ['RBRACKET',     /^】/],
      ['EMPTY_DICT',   /^\{\}/],
      ['LBRACE',       /^\{/],
      ['RBRACE',       /^\}/],
      ['FUNCTION',     /^〈[^〉]+〉/],
      ['NULL',         /^空っぽ/],
      ['BOOLEAN',      /^真|^偽/],
      
      ['KW_CLASS',     /^設計しよう|^下設計しよう/],
      ['KW_INTERFACE', /^規定しよう/],
      ['KW_REQUIRE',   /^なければならない/],
      ['KW_CONSTRUCT', /^最初に作られる時/],
      ['KW_DO_AS',     /^次のようにしよう/],
      ['KW_BASE',      /^基づいて|^もとにして/],
      ['KW_IMPLEMENTS',/^従う/],
      ['KW_GETTER',    /^取得する時/],
      ['KW_SETTER',    /^決める時/],
      
      ['KW_FUNC',      /^作ろう|^作って隠そう|^作って受け継ごう/],
      ['KW_ASSIGN',    /^隠そう|^受け継ごう|^にしよう|^固定しよう/],
      ['KW_DECLARE',   /^準備しよう/],
      ['KW_RETURN_TYPE',/^返す/],
      ['KW_RETURN',    /^返そう/],
      ['KW_PRINT_INLINE', /^続けて出力しよう/],
      ['KW_PRINT',     /^出力しよう/],
      ['KW_INPUT',     /^入力(させよう|してもらおう)/],
      ['KW_EXECUTE',   /^実行しよう/],
      
      ['KW_TRY',       /^とりあえずやってみよう/],
      ['KW_CATCH',     /^(エラーが\s*)?発生したら/],
      ['KW_FINALLY',   /^最後はいつも/],
      ['KW_THROW',     /^発生させよう/],
      
      ['KW_ELIF',      /^もしくは/],
      ['KW_IF',        /^もし/],
      ['KW_ELSE',      /^それ以外なら(ば)?/],
      ['KW_THEN',      /^なら(?:ば)?/],
      
      ['KW_SWITCH',    /^によって分けよう/],
      ['KW_CASE',      /^の場合/],
      ['KW_DEFAULT',   /^残りは/],
      ['KW_FALLTHROUGH', /^次に続けよう/],
      
      ['KW_WHILE',     /^間繰り返そう/],
      ['KW_FOREACH',   /^ごとに繰り返そう/],
      
      ['KW_TO',        /^まで繰り返そう/],
      ['KW_BREAK',     /^繰り返しを終わろう/],
      
      ['KW_IMPORT',    /^持ってこよう/],
      ['KW_ALL',       /^全部/],
      
      ['KW_VALUE',     /^値/],
      ['KW_INDEX',     /^番目(\s*の値)?/],
      ['KW_LENGTH',    /^長さ/],
      ['KW_PARENT',    /^親/],
      ['KW_OUTER',     /^外/],
      ['KW_NEW',       /^新しい/],
      ['KW_SELF',      /^私/],
      
      ['LOGIC',        /^(そして|または|かつ)/],
      ['COMPARE',      /^(==|!=|<=|>=|<|>|と同じだ|と同じ|と等しい|より大きい|より小さい|以上だ|以下だ|以上|以下|の一種だ|の一種|一種だ|一種|同じだ|同じ|等しい|異なる|違う|小さい|大きい)/],
      ['KW_FRONT',     /^前(で|に)?/],
      ['KW_BACK',      /^後(ろに|で|に)?/],
            ['PARTICLE',     /^(から|へ|より|くらい|を|に|で|は|が|の|と|も)/],
      ['KW_ADD',       /^足そう/],
      ['KW_SUB',       /^引こう/],
      ['KW_APPEND',    /^追加しよう/],
      ['KW_POP',       /^取り出そう|^取り出した/],
      
      ['OP',           /^[+\-*/%]/],
      
      ['COLON',        /^:/],
      ['NEWLINE',      /^\r?\n/],
      ['ASSIGN_OP',    /^=/],
      ['VARIABLE',     /^『[가-힣a-zA-Z0-9_ぁ-んァ-ン一-龥ー]+』/],
      ['LPAREN',       /^\(/],
      ['RPAREN',       /^\)/],
      ['COMMA',        /^[,、]/],
      
      ['SPACE',        /^[ \t　]+/],
      ['MISMATCH',     /^./],
    ];

    const indents = [0];
    const lines = this.code.split(/\r?\n/);
    let line_num = 1;

    for (let line of lines) {
      if (!line.trim() || line.trim().match(/^\(?(参考|注釈|メモ)(:|\)| )/)) {
        line_num += 1;
        continue;
      }
      
      line = line.replace(/\s*\(?(参考|注釈|メモ)(:|\)| ).*$/, '');

      const indent_match = line.match(/^[ \t　]*/);
      const current_indent = indent_match ? indent_match[0].length : 0;

      if (current_indent > indents[indents.length - 1]) {
        indents.push(current_indent);
        this.tokens.push({ type: 'INDENT', value: '', line: line_num, col: 0 });
      } else if (current_indent < indents[indents.length - 1]) {
        while (current_indent < indents[indents.length - 1]) {
          indents.pop();
          this.tokens.push({ type: 'DEDENT', value: '', line: line_num, col: 0 });
        }
      }

      let remaining = line;
      let col = 0;
      while (remaining.length > 0) {
        let matched = false;
        for (const [kind, regex] of token_specification) {
          const match = remaining.match(regex);
          if (match) {
            const value = match[0];
            if (kind !== 'SPACE') {
              if (kind === 'MISMATCH') {
                throw new KanadeError("SyntaxError: Unknown char 0x" + remaining.charCodeAt(0).toString(16), line_num, col, 1);
              }
              this.tokens.push({ type: kind, value: value.trim(), line: line_num, col: col });
            }
            remaining = remaining.substring(value.length);
            col += value.length;
            matched = true;
            break;
          }
        }
      }
      line_num += 1;
    }

    while (indents.length > 1) {
      indents.pop();
      this.tokens.push({ type: 'DEDENT', value: '', line: line_num, col: 0 });
    }
    
    // this.tokens.push({ type: 'EOF', value: '', line: line_num, col: 0 });
  }
}
