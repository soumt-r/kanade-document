// Mirrors hana/vm/list_ops.go. Go needs assignListBack because a Go
// []interface{} isn't a stable reference across append/slice ops; a JS Array
// mutates in place, so this port could technically mutate directly — but it
// keeps the same "recompute then write back to the binding" shape as Go
// anyway, since eval_expr.go's ListPopExpression/exec_stmt.go's
// ListPush/PopStatement all reuse this exact helper and diverging here would
// make those call sites harder to compare against the Go source line-by-line.
import type * as ast from "./ast";
import type { KanadeInterpreter } from "./interpreter";
import { Environment } from "./env";
import { evaluateNode } from "./evalExpr";
import { HajaObject } from "./object";

export function popFromList(list: unknown[], position: "front" | "back"): [unknown, unknown[]] {
  if (position === "front") return [list[0], list.slice(1)];
  return [list[list.length - 1], list.slice(0, -1)];
}

export async function assignListBack(i: KanadeInterpreter, target: ast.Expression, newList: unknown[], env: Environment): Promise<void> {
  if (target.type === "Identifier") {
    const [, err] = env.assign(target.value, newList);
    if (err) throw err;
    return;
  }
  if (target.type === "MemberExpression") {
    const obj = await evaluateNode(i, target.object, env);
    if (obj instanceof HajaObject && target.property.type === "Identifier") {
      obj.props[target.property.value] = newList;
    }
  }
}
