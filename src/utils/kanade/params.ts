// Mirrors hana/vm/params.go's bindParams.
import type * as ast from "./ast";
import type { KanadeInterpreter } from "./interpreter";
import { Environment } from "./env";
import { evaluateNode } from "./evalExpr";

// bindParams binds call arguments to a function/method/constructor's declared
// parameters into env:
//   - a missing argument whose parameter has a `default` expression gets that
//     default (evaluated in env, so it can see earlier-bound parameters and
//     the caller's scope);
//   - a missing argument with no default is a hard MissingArgumentError;
//   - more arguments than declared parameters is a hard ArgumentError.
export async function bindParams(i: KanadeInterpreter, params: ast.Parameter[], args: unknown[], env: Environment): Promise<void> {
  if (args.length > params.length) {
    throw new Error(`ArgumentError: 인자가 너무 많아요. ${params.length}개를 기대했는데 ${args.length}개를 받았어요.`);
  }
  for (let idx = 0; idx < params.length; idx++) {
    const param = params[idx];
    if (idx < args.length) {
      env.declare(param.name.value, args[idx]);
      continue;
    }
    if (param.default !== null) {
      const val = await evaluateNode(i, param.default, env);
      env.declare(param.name.value, val);
      continue;
    }
    throw new Error(`MissingArgumentError: '${param.name.value}' 인자가 필요해요.`);
  }
}
