// Mirrors hana/errs (Go): runtime code throws `new RuntimeError(Codes.X, ...args)`
// — only *what* went wrong — and a per-language catalog renders the wording at
// the two places a user sees it: the message a `발생했다면` handler catches
// (execStmt.ts's TryStatement) and the error the Playground shows
// (interpreter.ts's run()). The catalogs themselves are generated from the Go
// source of truth into errCatalog.ts (`go run ./cmd/errsgen` in hana/), so both
// engines print identical text and nobody re-types a message.
//
// This file is identical in haja-docs and kanade-docs.
import { Codes, catalogs, type Code } from "./errCatalog";

export { Codes };
export type { Code };

export type Locale = "en" | "ko" | "ja";

// The "<Kind>: " prefix (TypeError, ArgumentError, ...) is the part of the code
// before the dot and stays English in every language.
function kindOf(code: Code): string {
  const dot = code.indexOf(".");
  return dot >= 0 ? code.slice(0, dot) : code;
}

// Go's fmt verbs as the catalogs use them: %s %v %d, optionally with an
// explicit argument index (%[2]s). Any other text passes through untouched.
function sprintf(template: string, args: readonly unknown[]): string {
  let next = 0;
  return template.replace(/%(?:\[(\d+)\])?([svd])/g, (_match, idx: string | undefined, verb: string) => {
    const i = idx !== undefined ? Number(idx) - 1 : next++;
    const arg = args[i];
    if (verb === "d") return String(Math.trunc(Number(arg)));
    return String(arg);
  });
}

function render(loc: Locale, code: Code, args: readonly unknown[]): string {
  const template = catalogs[loc][code] ?? catalogs.en[code];
  if (template === undefined) return code;
  return `${kindOf(code)}: ${sprintf(template, args)}`;
}

// RuntimeError is what runtime code throws. `message` is the English wording
// (language-neutral, like Go's (*errs.Error).Error()); use localize() to show
// a user the wording in their language.
export class RuntimeError extends Error {
  code: Code;
  args: unknown[];

  constructor(code: Code, ...args: unknown[]) {
    super(render("en", code, args));
    this.name = "RuntimeError";
    this.code = code;
    this.args = args;
  }
}

// localize renders err in loc. A RuntimeError comes from the catalog; anything
// else (a user-thrown value's text, an engine bug) passes through unchanged.
export function localize(loc: Locale, err: unknown): string {
  if (err instanceof RuntimeError) return render(loc, err.code, err.args);
  if (err instanceof Error) return err.message;
  return String(err);
}

// accessViolation picks the Code for a member access refused by its modifier
// ("private" or "protected") — four wordings, one call for the throwing site.
export function accessViolation(access: string, isMethod: boolean, name: string): RuntimeError {
  if (access === "protected") {
    return new RuntimeError(isMethod ? Codes.ProtectedMethodAccess : Codes.ProtectedFieldAccess, name);
  }
  return new RuntimeError(isMethod ? Codes.PrivateMethodAccess : Codes.PrivateFieldAccess, name);
}

// typeNameOf names a runtime value's type in plain English for messages that
// mention it, without leaking JS internals.
export function typeNameOf(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return "number";
  if (typeof v === "string") return "string";
  if (typeof v === "boolean") return "boolean";
  if (Array.isArray(v)) return "list";
  if (v instanceof Map) return "dict";
  return "object";
}
