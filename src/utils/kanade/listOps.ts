// Mirrors hana/vm/list_ops.go. A list is an object: pushing, popping and emptying change the
// list itself (a JS Array is a reference, so every variable, parameter and field holding it
// sees the change), and what is left to do afterwards is to test the value that was put on
// against the type the variable or field was declared with — the caller takes the push back
// when it does not fit.
import type * as ast from "./ast";
import type { KanadeInterpreter } from "./interpreter";
import { Environment } from "./env";
import { evaluateNode } from "./evalExpr";
import { HariObject } from "./object";
import { RuntimeError, Codes } from "./errs";
import { checkDeclaredType, checkField } from "./types";

// requireMutable refuses to change the list a constant (고정하자) variable holds
// (Runtime spec 2.1 counts push, pop and emptying among the operations that change one).
export function requireMutable(env: Environment, target: ast.Expression): void {
  if (target.type === "Identifier" && env.isConst(target.value)) {
    throw new RuntimeError(Codes.ConstantAssignment, target.value);
  }
}

export async function checkListPush(i: KanadeInterpreter, target: ast.Expression, list: unknown[], env: Environment): Promise<void> {
  if (target.type === "Identifier") {
    checkDeclaredType(i, env, target.value, list);
    return;
  }
  if (target.type === "MemberExpression") {
    const obj = await evaluateNode(i, target.object, env);
    if (obj instanceof HariObject && target.property.type === "Identifier") {
      checkField(i, obj, target.property.value, list);
    }
  }
}

// pushOnto puts value on an end of list; takeBack undoes that.
export function pushOnto(list: unknown[], value: unknown, position: "front" | "back"): void {
  if (position === "front") list.unshift(value);
  else list.push(value);
}

export function takeBack(list: unknown[], position: "front" | "back"): void {
  if (position === "front") list.shift();
  else list.pop();
}

export function popFromList(list: unknown[], position: "front" | "back"): unknown {
  return position === "front" ? list.shift() : list.pop();
}
