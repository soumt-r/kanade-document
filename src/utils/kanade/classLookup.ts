// Mirrors hana/vm/class_lookup.go.
import type * as ast from "./ast";
import type { KanadeInterpreter } from "./interpreter";
import { ThrownSignal } from "./errors";
import { HariObject } from "./object";

// findInClassChain walks cls up its baseClass chain, calling visit(body) at
// each level. visit returns true once it has found what it was looking for
// (or determined this class "shadows" the name even without a full match) —
// that stops the walk, matching 하자's shadowing rule: once a name is found
// in a class, ancestors are never consulted for the same name.
export function findInClassChain(
  i: KanadeInterpreter,
  cls: ast.ClassDeclaration | null,
  visit: (body: ast.Statement[]) => boolean,
): void {
  let cur = cls;
  while (cur !== null) {
    if (visit(cur.body)) return;
    if (cur.baseClass === null) return;
    cur = i.classes[cur.baseClass.name] ?? null;
  }
}

// classIsOrExtends reports whether className is targetName itself, or
// inherits from it directly/transitively via baseClass (upcasting).
export function classIsOrExtends(i: KanadeInterpreter, className: string, targetName: string): boolean {
  let cur: string | null = className;
  while (cur !== null && cur !== "") {
    if (cur === targetName) return true;
    const cls: ast.ClassDeclaration | undefined = i.classes[cur];
    if (!cls || cls.baseClass === null) return false;
    cur = cls.baseClass.name;
  }
  return false;
}

// thrownValueMatchesType checks whether a TryStatement's block threw a value
// matching a CatchClause's declared type. Only a thrown HariObject (an actual
// class instance) has a class to match against — an engine-raised error
// (TypeError, ...) is a plain Error, never a class instance, and is only
// reachable through an untyped catch handler.
export function thrownValueMatchesType(i: KanadeInterpreter, err: unknown, typeName: string): boolean {
  if (!(err instanceof ThrownSignal)) return false;
  if (!(err.value instanceof HariObject)) return false;
  return classIsOrExtends(i, err.value.className, typeName);
}
