// Mirrors hana/token/token.go. TokenType stays a plain string (not a TS enum)
// for the same reason Go's is just `type TokenType string`: lexer/parser both
// compare literals directly, and a handful of kinds (INDENT, TYPE, PARTICLE,
// ...) exist only as ad hoc string literals on the Go side too — promoted to
// named constants here since TS callers benefit more from that than Go's did.

export type TokenType = string;

export interface Token {
  type: TokenType;
  literal: string;
  line: number;
  col: number; // 0-based, in UTF-16 units of the source line
}

export const EOF = "EOF";

// A character no lexer rule accepts. It stays in the stream so the parser
// reports it as an unexpected token (mirrors hana/token.ILLEGAL).
export const ILLEGAL = "ILLEGAL";

export const IDENT = "IDENT";
export const INT = "INT";
export const STRING = "STRING";
export const VAR = "VAR";

export const COLON = ":";
export const ASSIGN = "="; // 함수 파라미터 기본값 구분자 (예: '이름' = "손님")

export const LBRACKET = "[";
export const RBRACKET = "]";
export const LPAREN = "(";
export const RPAREN = ")";
export const LBRACE = "{";
export const RBRACE = "}";
export const COMMA = ",";

export const KW_PRINT = "KW_PRINT"; // 출력하자
export const KW_INPUT = "KW_INPUT"; // 입력받자
export const KW_MAKE = "KW_MAKE"; // 만들자, 정하자
export const KW_INTERFACE = "KW_INTERFACE"; // 규정하자
export const KW_CLASS = "KW_CLASS"; // 설계하자
export const KW_IMPLEMENTS = "KW_IMPLEMENTS"; // 따르는
export const KW_IF = "KW_IF"; // 만약
export const KW_ELSE = "KW_ELSE"; // 그렇지 않다면
export const KW_CONSTRUCT = "KW_CONSTRUCT";
export const KW_DO_AS = "KW_DO_AS";
export const KW_BASE = "KW_BASE";
export const KW_GETTER = "KW_GETTER";
export const KW_SETTER = "KW_SETTER";
export const KW_FRONT = "KW_FRONT";
export const KW_BACK = "KW_BACK";
export const KW_ADD = "KW_ADD";
export const KW_SUB = "KW_SUB";
export const KW_EXECUTE = "KW_EXECUTE"; // 실행하자
export const KW_MUST_HAVE = "KW_MUST_HAVE"; // 있어야 한다
export const KW_NULL = "KW_NULL"; // 비어있음
export const KW_RETURN = "KW_RETURN"; // 돌려주자
export const KW_BREAK = "KW_BREAK"; // 반복을 끝내자
export const KW_LOOP = "KW_LOOP"; // 반복하자
export const KW_PUSH = "KW_PUSH"; // 추가하자
export const KW_POP = "KW_POP"; // 꺼내자
export const KW_POPPED = "KW_POPPED"; // 꺼낸 (표현식 형태: '목록' 뒤에서 꺼낸 값)
export const KW_TRY = "KW_TRY"; // 일단 해보자
export const KW_CATCH = "KW_CATCH"; // 발생했다면
export const KW_FINALLY = "KW_FINALLY"; // 마무리는 항상
export const KW_THROW = "KW_THROW"; // 던지자
export const KW_IMPORT = "KW_IMPORT";
export const KW_FROM = "KW_FROM";
export const KW_TRUE = "KW_TRUE";
export const KW_FALSE = "KW_FALSE";
export const KW_PARENT = "KW_PARENT";
export const KW_OUTER = "KW_OUTER";
export const KW_NEW = "KW_NEW";
export const KW_SELF = "KW_SELF";
export const KW_SWITCH = "KW_SWITCH";
export const KW_CASE = "KW_CASE";
export const KW_DEFAULT = "KW_DEFAULT";
export const KW_FALLTHROUGH = "KW_FALLTHROUGH";
export const KW_AND = "KW_AND"; // 그리고
export const KW_OR = "KW_OR"; // 또는

// KW_ELIF: an "else if" fused into one word (카나데: "もしくは"). 하자has no
// equivalent — it chains else-if by writing KW_ELSE immediately followed by a
// separate KW_IF token ("그렇지 않고 만약"). Kept here even though this repo's
// lexer never emits it, purely so parser.ts's elif-handling branch (mirroring
// parser/hari/parser.go's parseIfBody) type-checks identically to the Go
// source it's ported from.
export const KW_ELIF = "KW_ELIF";

// Ad hoc token kinds Go's lexer/hari/lexer.go creates as bare string literals
// rather than token.* constants — centralized here as real constants since a
// TS lexer/parser pair benefits more from that than the Go one did.
export const INDENT = "INDENT";
export const DEDENT = "DEDENT";
export const FUNCTION = "FUNCTION";
export const TYPE = "TYPE";
export const TEMPLATE_STRING = "TEMPLATE_STRING";
export const COMPARE = "COMPARE";
export const OP = "OP";
export const TYPE_IN = "TYPE_IN";
export const PARTICLE = "PARTICLE";
export const SPACE = "SPACE";
