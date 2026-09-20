// Mirrors hana/typecheck (Go): the dynamic type checker of Runtime spec 2.2.
// Does a runtime value satisfy a declared type such as [숫자], [(숫자)목록] or
// [자동차]? Values are the engine's own: number, string, boolean, null, Array
// (list), Map (dictionary) and HajaObject (a class instance, via the host).
//
// This file is identical in haja-docs and kanade-docs.
import { RuntimeError, Codes } from "./errs";

// A language's names for the built-in types (하자: 숫자, 문자열, 논리, 아무거나,
// 목록, 사전, 비어있음; 카나데: 数字, 文字列, 論理, 何でも, リスト, 辞書, 空っぽ).
export interface TypeNames {
  number: string;
  string: string;
  boolean: string;
  any: string;
  list: string;
  dict: string;
  null: string;
}

// A parsed annotation: a base name and, for generics like `(문자열, 숫자)사전`,
// its type arguments.
export interface TypeSpec {
  name: string;
  args: string[];
}

// parseType reads an annotation as the parser stores it: "숫자", "(숫자)목록",
// "(문자열, 숫자)사전". The empty string (no annotation) is the Any type.
export function parseType(annotation: string): TypeSpec {
  const text = annotation.trim();
  if (text.startsWith("(")) {
    const end = text.indexOf(")");
    if (end > 0) {
      const args = text
        .slice(1, end)
        .split(",")
        .map((a) => a.trim())
        .filter((a) => a !== "");
      return { name: text.slice(end + 1).trim(), args };
    }
  }
  return { name: text, args: [] };
}

// The host answers what only the engine knows about user classes.
export interface TypeHost {
  classOf(v: unknown): string | null;
  isSubtype(cls: string, target: string): boolean;
}

// accepts reports whether v satisfies spec. Null is accepted by every type
// (Nullable by default), and an omitted or [아무거나] type accepts anything.
export function accepts(spec: TypeSpec, names: TypeNames, v: unknown, host: TypeHost): boolean {
  if (v === null || v === undefined || spec.name === "" || spec.name === names.any) return true;
  switch (spec.name) {
    case names.number:
      return typeof v === "number";
    case names.string:
      return typeof v === "string";
    case names.boolean:
      return typeof v === "boolean";
    case names.null:
      return false; // v is not null here
    case names.list: {
      if (!Array.isArray(v)) return false;
      if (spec.args.length > 0) {
        const elem: TypeSpec = { name: spec.args[0], args: [] };
        return v.every((e) => accepts(elem, names, e, host));
      }
      return true;
    }
    case names.dict: {
      if (!(v instanceof Map)) return false;
      if (spec.args.length > 0) {
        const keySpec: TypeSpec = spec.args.length === 1 ? { name: "", args: [] } : { name: spec.args[0], args: [] };
        const valSpec: TypeSpec = { name: spec.args.length === 1 ? spec.args[0] : spec.args[1], args: [] };
        for (const [k, e] of v) {
          if (!accepts(keySpec, names, k, host) || !accepts(valSpec, names, e, host)) return false;
        }
      }
      return true;
    }
  }
  const cls = host.classOf(v);
  return cls !== null && (cls === spec.name || host.isSubtype(cls, spec.name));
}

// describe names v's type for an error message, in the language's own words.
export function describe(names: TypeNames, v: unknown, host: TypeHost): string {
  if (v === null || v === undefined) return names.null;
  if (typeof v === "number") return names.number;
  if (typeof v === "string") return names.string;
  if (typeof v === "boolean") return names.boolean;
  if (Array.isArray(v)) return names.list;
  if (v instanceof Map) return names.dict;
  return host.classOf(v) ?? "?";
}

// checkType throws VariableTypeMismatch when v does not fit the annotation.
export function checkType(names: TypeNames, annotation: string, name: string, v: unknown, host: TypeHost): void {
  if (!accepts(parseType(annotation), names, v, host)) {
    throw new RuntimeError(Codes.VariableTypeMismatch, name, annotation, describe(names, v, host));
  }
}

// checkReturnType is checkType for the value a function returns.
export function checkReturnType(names: TypeNames, annotation: string, fn: string, v: unknown, host: TypeHost): void {
  if (!accepts(parseType(annotation), names, v, host)) {
    throw new RuntimeError(Codes.ReturnTypeMismatch, fn, annotation, describe(names, v, host));
  }
}

// checkArgumentType is checkType for a function parameter.
export function checkArgumentType(names: TypeNames, annotation: string, name: string, v: unknown, host: TypeHost): void {
  if (!accepts(parseType(annotation), names, v, host)) {
    throw new RuntimeError(Codes.ArgumentTypeMismatch, name, annotation, describe(names, v, host));
  }
}
