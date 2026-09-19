// Mirrors hana/vm/interpreter.go's control-flow signal types and adds the
// TS-only syntax/runtime error split index.ts's public contract needs (see
// haja-docs' errors.ts for the full rationale — identical here).
//
// KanadeError's message format ("N行目、N文字目: ...") is deliberately fixed:
// the previous ad hoc engine threw "N번째 줄" (Korean "line N") from a
// Japanese-language site's own error path — a copy-paste leftover from the
// Haja engine that never got translated — while hajaLSP.ts's linter regex
// expected "N行目" and so never actually matched it. Both now agree on one
// Japanese format.

export class KanadeError extends Error {
  line: number;
  col: number;
  length: number;

  constructor(message: string, line: number, col = 0, length = 1) {
    super(`${line}行目、${col}文字目: ${message}`);
    this.name = "KanadeError";
    this.line = line;
    this.col = col;
    this.length = length;
  }
}

// The parser found syntax problems; message is the finished, localized report
// (index.ts throws it as-is, without an engine-bug prefix).
export class KanadeSyntaxReport extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KanadeSyntaxReport";
  }
}

export class KanadeRuntimeError extends Error {
  line: number | string;
  hajaObj?: unknown;

  constructor(message: string, line: number | string = "?", hajaObj?: unknown) {
    super(message);
    this.name = "KanadeRuntimeError";
    this.line = line;
    this.hajaObj = hajaObj;
  }
}

export class ReturnSignal extends Error {
  value: unknown;
  constructor(value: unknown) {
    super("return");
    this.name = "ReturnSignal";
    this.value = value;
  }
}

export class BreakSignal extends Error {
  constructor() {
    super("break");
    this.name = "BreakSignal";
  }
}

export class ThrownSignal extends Error {
  value: unknown;
  constructor(value: unknown) {
    super(typeof value === "string" ? value : String(value));
    this.name = "ThrownSignal";
    this.value = value;
  }
}
