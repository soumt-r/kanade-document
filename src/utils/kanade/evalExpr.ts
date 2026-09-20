// Mirrors hana/vm/eval_expr.go's Evaluate — one dispatch over every
// ast.Expression variant. Go signals control flow (return) via a typed error
// value threaded through every call site; this port throws ReturnSignal
// instead and lets it unwind naturally, so the per-statement
// "if err != nil { if ret, ok := err.(*ReturnValue) ... }" checks Go needs
// collapse into a single try/catch around each function body (see execBlock
// below) — a deliberate, justified simplification enabled by using real JS
// exceptions where Go only has plain error returns.
import * as ast from "./ast";
import type { KanadeInterpreter } from "./interpreter";
import { MAX_CALL_DEPTH } from "./config";
import { checkInitialField, checkReturn, describeType, requireBool } from "./types";
import { Environment } from "./env";
import { executeStmt } from "./execStmt";
import { bindParams } from "./params";
import { popFromList, requireMutable } from "./listOps";
import { findInClassChain, classIsOrExtends } from "./classLookup";
import {
  HajaObject,
  BoundMethod,
  BuiltinFunction,
  BoundStringMethod,
  BoundListMethod,
  BoundStaticMethod,
  SuperReferenceValue,
  ClassReference,
} from "./object";
import { ReturnSignal } from "./errors";
import { parseExpressionFromSource } from "./parser";
import { RuntimeError, Codes, accessViolation, typeNameOf } from "./errs";

// execBlock runs a statement list in env and returns the function's return
// value if a ReturnStatement fired inside it (mirrors every Go call site's
// "loop Execute, catch *ReturnValue" pattern).
export async function execBlock(i: KanadeInterpreter, statements: ast.Statement[], env: Environment): Promise<unknown> {
  try {
    for (const s of statements) {
      await executeStmt(i, s, env);
    }
    return null;
  } catch (e) {
    if (e instanceof ReturnSignal) return e.value;
    throw e;
  }
}

function unescapeString(val: string): string {
  return val.replaceAll("\\n", "\n").replaceAll('\\"', '"').replaceAll("\\t", "\t").replaceAll("\\\\", "\\");
}

/** Runs a function value — a name from `<이름>`, a declared function, a builtin, or a bound method —
 *  with already-evaluated arguments. The standard library calls the functions it is given through this. */
export async function callValue(i: Interpreter, env: Environment, callee: unknown, args: unknown[]): Promise<unknown> {
  if (typeof callee === "string") {
    const funcName = callee;
    const [fnVal] = env.get(funcName);
    if (fnVal instanceof BuiltinFunction) {
      return await fnVal.fn(env, ...args);
    }

    let funcDecl: ast.FunctionDeclaration | null = null;
    if (fnVal && (fnVal as ast.FunctionDeclaration).type === "FunctionDeclaration") {
      funcDecl = fnVal as ast.FunctionDeclaration;
    }
    if (funcDecl === null) {
      for (const stmt of i.ast.statements) {
        if (stmt.type === "FunctionDeclaration" && stmt.name.value === funcName) {
          funcDecl = stmt;
          break;
        }
      }
    }
    if (funcDecl === null) throw new RuntimeError(Codes.GlobalFunctionNotFound, funcName);
    const funcEnv = new Environment(i.globalEnv);
    await bindParams(i, funcDecl.params, args, funcEnv);
    return checkReturn(i, funcDecl, await execBlock(i, funcDecl.body.statements, funcEnv));
  }

  if (callee instanceof BuiltinFunction) {
    return await callee.fn(env, ...args);
  }

  if (callee && (callee as ast.FunctionDeclaration).type === "FunctionDeclaration") {
    const fnDecl = callee as ast.FunctionDeclaration;
    const callEnv = new Environment(i.globalEnv);
    await bindParams(i, fnDecl.params, args, callEnv);
    return checkReturn(i, fnDecl, await execBlock(i, fnDecl.body.statements, callEnv));
  }

  if (callee instanceof BoundStaticMethod) {
    const cls = i.classes[callee.className];
    let funcDecl: ast.FunctionDeclaration | null = null;
    for (const stmt of cls.body) {
      if (stmt.type === "FunctionDeclaration" && stmt.isStatic && stmt.name.value === callee.funcName) {
        funcDecl = stmt;
        break;
      }
    }
    if (funcDecl === null) throw new RuntimeError(Codes.StaticMethodNotFound, callee.funcName);
    const funcEnv = new Environment(i.globalEnv);
    funcEnv.declare("__selfClass__", callee.className);
    await bindParams(i, funcDecl.params, args, funcEnv);
    return checkReturn(i, funcDecl, await execBlock(i, funcDecl.body.statements, funcEnv));
  } else if (callee instanceof BoundStringMethod) {
    // 인자 개수/타입을 먼저 확인한다 — 확인 없이 바로 args[0]에 접근하면
    // 인자가 없거나 타입이 틀릴 때 하자 에러가 아니라 JS 예외로 죽는다.
    if (callee.funcName === i.config.stringSliceMethod) {
      if (args.length !== 2) throw new RuntimeError(Codes.ArgCountExact, 2);
      const [startNum, endNum] = args;
      if (typeof startNum !== "number" || typeof endNum !== "number") {
        throw new RuntimeError(Codes.MethodArgMustBeNumber, callee.funcName);
      }
      const chars = Array.from(callee.value);
      let start = startNum - 1;
      let end = endNum;
      if (start < 0) start = 0;
      if (end > chars.length) end = chars.length;
      if (start > end) start = end;
      return chars.slice(start, end).join("");
    } else if (callee.funcName === i.config.stringReplaceMethod) {
      if (args.length !== 2) throw new RuntimeError(Codes.ArgCountExact, 2);
      const [oldStr, newStr] = args;
      if (typeof oldStr !== "string" || typeof newStr !== "string") {
        throw new RuntimeError(Codes.MethodArgMustBeString, callee.funcName);
      }
      return callee.value.split(oldStr).join(newStr);
    } else if (callee.funcName === i.config.stringSplitMethod) {
      if (args.length !== 1) throw new RuntimeError(Codes.ArgCountExact, 1);
      const sep = args[0];
      if (typeof sep !== "string") throw new RuntimeError(Codes.MethodArgMustBeString, callee.funcName);
      return callee.value.split(sep);
    } else if (callee.funcName === i.config.stringContainsMethod) {
      if (args.length !== 1) throw new RuntimeError(Codes.ArgCountExact, 1);
      const sub = args[0];
      if (typeof sub !== "string") throw new RuntimeError(Codes.MethodArgMustBeString, callee.funcName);
      return callee.value.includes(sub);
    }
    throw new RuntimeError(Codes.MethodNotFound, callee.funcName);
  } else if (callee instanceof BoundListMethod) {
    // 목록은 "언어 네이티브 구문"(추가하자/꺼내자 등)으로 조작하는 게 기본
    // 설계라, 메서드 형태로 남은 건 비우기 하나뿐.
    if (callee.funcName === i.config.listClearMethod) {
      if (args.length !== 0) throw new RuntimeError(Codes.ArgCountExact, 0);
      if (callee.target !== null) requireMutable(env, callee.target);
      callee.list.length = 0;
      return null;
    }
    throw new RuntimeError(Codes.MethodNotFound, callee.funcName);
  } else if (callee instanceof BoundMethod) {
    const cls = i.classes[callee.object.className];
    let funcDecl: ast.FunctionDeclaration | null = null;
    let ctorDecl: ast.ConstructorDeclaration | null = null;

    // super 호출이면 부모부터 탐색을 시작해, 오버라이딩되기 전의 원본을 찾는다.
    let startCls = cls;
    if (callee.isSuper && startCls && startCls.baseClass) {
      startCls = i.classes[startCls.baseClass.name];
    }
    findInClassChain(i, startCls, (body) => {
      for (const stmt of body) {
        if (stmt.type === "FunctionDeclaration" && stmt.name.value === callee.funcName) {
          funcDecl = stmt;
          return true;
        } else if (stmt.type === "ConstructorDeclaration" && callee.funcName === "__init__") {
          ctorDecl = stmt;
          return true;
        }
      }
      return false;
    });
    if (funcDecl === null && ctorDecl === null) {
      throw new RuntimeError(Codes.MethodNotFound, callee.funcName);
    }
    const funcEnv = new Environment(i.globalEnv);
    funcEnv.this_ = callee.object;
    funcEnv.declare("this", callee.object);
    funcEnv.declare("__selfClass__", callee.object.className);

    if (funcDecl !== null) {
      await bindParams(i, (funcDecl as ast.FunctionDeclaration).params, args, funcEnv);
      const method = funcDecl as ast.FunctionDeclaration;
      return checkReturn(i, method, await execBlock(i, method.body.statements, funcEnv));
    } else if (ctorDecl !== null) {
      await bindParams(i, (ctorDecl as ast.ConstructorDeclaration).params, args, funcEnv);
      return await execBlock(i, (ctorDecl as ast.ConstructorDeclaration).body, funcEnv);
    }
    return null;
  }
  throw new RuntimeError(Codes.NotCallable);
}

export async function evaluateNode(i: KanadeInterpreter, expr: ast.Expression | null, env: Environment): Promise<unknown> {
  if (expr === null) return null;

  // Calls and constructions are what recurse; count them like hana's Evaluate does.
  if (expr.type === "CallExpression" || expr.type === "NewExpression") {
    if (i.callDepth >= MAX_CALL_DEPTH) throw new RuntimeError(Codes.CallTooDeep, MAX_CALL_DEPTH);
    i.callDepth++;
    try {
      return await evaluateNodeInner(i, expr, env);
    } finally {
      i.callDepth--;
    }
  }
  return evaluateNodeInner(i, expr, env);
}

async function evaluateNodeInner(i: KanadeInterpreter, expr: ast.Expression, env: Environment): Promise<unknown> {
  switch (expr.type) {
    case "TypeReference": {
      const [clsObj, exists] = env.get(expr.name);
      if (exists) return clsObj;
      if (i.classes[expr.name]) return new ClassReference(expr.name);
      return expr.name;
    }
    case "StringLiteral":
      return unescapeString(expr.value);
    case "BooleanLiteral":
      return expr.value;
    case "TemplateLiteral": {
      const raw = unescapeString(expr.value);
      let result = "";
      let rest = raw;
      for (;;) {
        const open = rest.indexOf("{");
        if (open === -1) {
          result += rest;
          break;
        }
        result += rest.slice(0, open);
        rest = rest.slice(open + 1);
        const close = rest.indexOf("}");
        if (close === -1) {
          result += "{" + rest;
          break;
        }
        const innerCode = rest.slice(0, close);
        rest = rest.slice(close + 1);
        const innerExpr = i.config.parseEmbeddedExpr ? i.config.parseEmbeddedExpr(innerCode) : parseExpressionFromSource(innerCode);
        if (innerExpr) {
          const val = await evaluateNode(i, innerExpr, env);
          result += i.formatValue(val);
        }
      }
      return result;
    }
    case "NullLiteral":
      return null;
    case "NumberLiteral":
      return expr.value;
    case "SelfReference": {
      let cur: Environment | null = env;
      while (cur !== null) {
        if (cur.this_ !== null) return cur.this_;
        cur = cur.parent;
      }
      throw new RuntimeError(Codes.ThisNotBound);
    }
    case "SuperReference": {
      let cur: Environment | null = env;
      while (cur !== null) {
        if (cur.this_ !== null) return new SuperReferenceValue(cur.this_);
        cur = cur.parent;
      }
      throw new RuntimeError(Codes.SuperOutsideMethod);
    }
    case "StaticReference": {
      let cur: Environment | null = env;
      while (cur !== null) {
        const [val, ok] = cur.get("__selfClass__");
        if (ok && typeof val === "string") return new ClassReference(val);
        cur = cur.parent;
      }
      throw new RuntimeError(Codes.StaticOutsideMethod);
    }
    case "Identifier": {
      if (i.config.selfWords.includes(expr.value)) {
        let cur: Environment | null = env;
        while (cur !== null) {
          if (cur.this_ !== null) return cur.this_;
          cur = cur.parent;
        }
      } else if (i.config.pluralSelfWords.includes(expr.value)) {
        const [clsName, exists] = env.get("__selfClass__");
        if (exists && typeof clsName === "string") return new ClassReference(clsName);
      }

      const [val, ok] = env.get(expr.value);
      if (!ok) {
        if (i.classes[expr.value]) return new ClassReference(expr.value);
        throw new RuntimeError(Codes.VariableNotFound, expr.value);
      }
      return val;
    }
    case "FunctionReference": {
      let name = expr.name;
      if (name.startsWith(i.config.varQuoteOpen) && name.endsWith(i.config.varQuoteClose)) {
        const idName = name.slice(i.config.varQuoteOpen.length, name.length - i.config.varQuoteClose.length);
        const [val, ok] = env.get(idName);
        if (ok && typeof val === "string") name = val;
      }
      if (name.includes(".")) {
        const dotIdx = name.indexOf(".");
        const objName = name.slice(0, dotIdx);
        const methodName = name.slice(dotIdx + 1);
        const [val, ok] = env.get(objName);
        if (ok && val instanceof HajaObject) {
          return new BoundMethod(val, methodName);
        }
      }

      let fnDecl: ast.FunctionDeclaration | null = null;
      for (const stmt of i.ast.statements) {
        if (stmt.type === "FunctionDeclaration" && stmt.name.value === name) {
          fnDecl = stmt;
          break;
        }
      }
      if (fnDecl === null) {
        const [val] = env.get(name);
        if (val && (val as ast.FunctionDeclaration).type === "FunctionDeclaration") fnDecl = val as ast.FunctionDeclaration;
      }
      if (fnDecl !== null) return fnDecl;

      return name;
    }
    case "NewExpression": {
      const clsName = expr.class.name;
      const cls = i.classes[clsName];
      if (!cls) {
        if (i.interfaces[clsName]) throw new RuntimeError(Codes.Interface, clsName);
        throw new RuntimeError(Codes.ClassNotFound, clsName);
      }
      if (cls.isAbstract) throw new RuntimeError(Codes.AbstractClass, clsName);
      const obj = new HajaObject(clsName);

      for (const stmt of cls.body) {
        if (stmt.type === "VariableDeclaration" && !stmt.isStatic) {
          const initial = await evaluateNode(i, stmt.value, env);
          checkInitialField(i, stmt, initial);
          obj.props[stmt.name.value] = initial;
        } else if (stmt.type === "Assignment" && stmt.target.type === "Identifier") {
          obj.props[stmt.target.value] = await evaluateNode(i, stmt.value, env);
        }
      }

      let ctor: ast.ConstructorDeclaration | null = null;
      findInClassChain(i, cls, (body) => {
        for (const stmt of body) {
          if (stmt.type === "ConstructorDeclaration") {
            ctor = stmt;
            return true;
          }
        }
        return false;
      });

      if (ctor !== null) {
        const args: unknown[] = [];
        for (const argExpr of expr.arguments) args.push(await evaluateNode(i, argExpr, env));
        const ctorEnv = new Environment(i.globalEnv);
        ctorEnv.this_ = obj;
        ctorEnv.declare("__selfClass__", clsName);
        await bindParams(i, (ctor as ast.ConstructorDeclaration).params, args, ctorEnv);
        await execBlock(i, (ctor as ast.ConstructorDeclaration).body, ctorEnv);
      }

      return obj;
    }
    case "CallExpression": {
      let callCallee: ast.Expression = expr.callee;
      // "TYPE의 〈함수〉()": TYPE-then-TYPE_IN can't tell at parse time whether
      // TYPE names a real class (a static method call) or a built-in type
      // name used as decorative packaging around a plain builtin call — only
      // a real registered class means "static method call".
      if (callCallee.type === "MemberExpression" && callCallee.object.type === "TypeReference") {
        const typeRef = callCallee.object;
        if (!i.classes[typeRef.name] && callCallee.property.type === "FunctionReference") {
          callCallee = callCallee.property;
        }
      }
      const callee = await evaluateNode(i, callCallee, env);

      const args: unknown[] = [];
      for (const argExpr of expr.arguments) args.push(await evaluateNode(i, argExpr, env));

      return await callValue(i, env, callee, args);
    }
    case "ListLiteral": {
      const elements: unknown[] = [];
      for (const el of expr.elements) elements.push(await evaluateNode(i, el, env));
      return elements;
    }
    case "ListPopExpression": {
      const targetVal = await evaluateNode(i, expr.target, env);
      if (!Array.isArray(targetVal)) throw new RuntimeError(Codes.NotAList);
      requireMutable(env, expr.target);
      if (targetVal.length === 0) throw new RuntimeError(Codes.ListEmpty);
      return popFromList(targetVal, expr.position);
    }
    case "DictLiteral": {
      const dict = new Map<unknown, unknown>();
      for (const prop of expr.properties) {
        const key = await evaluateNode(i, prop.key, env);
        const val = await evaluateNode(i, prop.value, env);
        dict.set(key, val);
      }
      return dict;
    }
    case "MemberExpression": {
      let property = expr.property;
      if (property.type === "FunctionReference") {
        if (property.name.startsWith(i.config.varQuoteOpen) && property.name.endsWith(i.config.varQuoteClose)) {
          const idName = property.name.slice(i.config.varQuoteOpen.length, property.name.length - i.config.varQuoteClose.length);
          const [val, ok] = env.get(idName);
          if (ok && typeof val === "string") property = { ...property, name: val };
        }
      }
      const obj = await evaluateNode(i, expr.object, env);

      if (obj instanceof SuperReferenceValue) {
        if (property.type !== "FunctionReference") {
          throw new RuntimeError(Codes.SuperMemberMustBeMethod);
        }
        return new BoundMethod(obj.object, property.name, true);
      }
      if (obj instanceof HajaObject) {
        let propName = "";
        let isFunc = false;
        if (property.type === "FunctionReference") {
          propName = property.name;
          isFunc = true;
        } else if (property.type === "Identifier") {
          propName = property.value;
        }

        const cls = i.classes[obj.className];
        let access = "public";
        findInClassChain(i, cls, (body) => {
          for (const stmt of body) {
            if (isFunc) {
              if (stmt.type === "FunctionDeclaration" && stmt.name.value === propName) {
                access = stmt.accessModifier;
                return true;
              }
            } else {
              if (stmt.type === "VariableDeclaration" && stmt.name.value === propName) {
                access = stmt.accessModifier;
                return true;
              }
            }
          }
          return false;
        });

        if (access !== "public") {
          const [thisObj, hasThis] = env.get("this");
          if (!hasThis) {
            throw accessViolation(access, isFunc, propName);
          }
          if (access === "private" && thisObj !== obj) {
            throw accessViolation(access, isFunc, propName);
          }
        }

        if (isFunc) return new BoundMethod(obj, propName);

        let getterBody: ast.Statement[] | null = null;
        findInClassChain(i, cls, (body) => {
          for (const stmt of body) {
            if (stmt.type === "VariableDeclaration" && stmt.name.value === propName) {
              getterBody = stmt.getter;
              return true;
            }
          }
          return false;
        });
        if (getterBody !== null) {
          const getterEnv = new Environment(i.globalEnv);
          getterEnv.this_ = obj;
          getterEnv.declare("this", obj);
          getterEnv.declare("__selfClass__", obj.className);
          return await execBlock(i, getterBody, getterEnv);
        }
        return obj.props[propName];
      } else if (Array.isArray(obj)) {
        let propName = "";
        let isFunc = false;
        if (property.type === "FunctionReference") {
          propName = property.name;
          isFunc = true;
        } else if (property.type === "Identifier") {
          propName = property.value;
        }

        if (isFunc) return new BoundListMethod(obj, propName, expr.object);
        if (propName === i.config.lengthWord) return obj.length;

        const idxObj = await evaluateNode(i, property, env).catch(() => undefined);
        if (typeof idxObj === "number") {
          const idx = idxObj - 1;
          if (idx < 0 || idx >= obj.length) throw new RuntimeError(Codes.ListIndexOutOfRange);
          return obj[idx];
        }
        throw new RuntimeError(Codes.ListIndexMustBeNumber);
      } else if (obj instanceof Map) {
        const key = await evaluateNode(i, property, env);
        if (obj.has(key)) return obj.get(key);
        throw new RuntimeError(Codes.DictKeyNotFound, key);
      } else if (obj instanceof ClassReference) {
        const clsName = obj.className;
        let propName = "";
        let isFunc = false;
        if (property.type === "FunctionReference") {
          propName = property.name;
          isFunc = true;
        } else if (property.type === "Identifier") {
          propName = property.value;
        } else if (property.type === "NumberLiteral") {
          propName = String(property.value);
        }

        const cls = i.classes[clsName];
        if (!cls) throw new RuntimeError(Codes.ClassNotFound, clsName);

        if (isFunc) {
          for (const stmt of cls.body) {
            if (stmt.type === "FunctionDeclaration" && stmt.isStatic && stmt.name.value === propName) {
              return new BoundStaticMethod(clsName, propName);
            }
          }
        } else {
          const globalKey = clsName + "." + propName;
          const [val, ok] = i.globalEnv.get(globalKey);
          if (ok) return val;
        }
        throw new RuntimeError(Codes.StaticMemberNotFound, propName);
      } else if (typeof obj === "string") {
        let propName = "";
        let isFunc = false;
        if (property.type === "FunctionReference") {
          propName = property.name;
          isFunc = true;
        } else if (property.type === "Identifier") {
          propName = property.value;
        } else if (property.type === "NumberLiteral") {
          propName = String(property.value);
        }

        if (isFunc) return new BoundStringMethod(obj, propName);
        if (propName === i.config.lengthWord) return Array.from(obj).length;

        const idxObj = await evaluateNode(i, property, env).catch(() => undefined);
        if (typeof idxObj === "number") {
          const idx = idxObj - 1;
          const chars = Array.from(obj);
          if (idx < 0 || idx >= chars.length) throw new RuntimeError(Codes.StringIndexOutOfRange);
          return chars[idx];
        }
        throw new RuntimeError(Codes.MemberAccessOnString);
      }
      throw new RuntimeError(Codes.MemberAccessUnsupported, typeNameOf(obj));
    }
    case "LogicalExpression": {
      const left = await evaluateNode(i, expr.left, env);
      const leftBool = requireBool(left, i);
      if (expr.operator === "그리고") {
        if (!leftBool) return false;
      } else if (leftBool) {
        return true;
      }
      const right = await evaluateNode(i, expr.right, env);
      return requireBool(right, i);
    }
    case "BinaryExpression": {
      const left = await evaluateNode(i, expr.left, env);
      const right = await evaluateNode(i, expr.right, env);

      if (expr.operator === "instanceof") {
        if (left instanceof HajaObject && right instanceof ClassReference) {
          return classIsOrExtends(i, left.className, right.className);
        }
        return false;
      }

      if (expr.operator === "==" || expr.operator === "!=") {
        if (left instanceof HajaObject) {
          const cls = i.classes[left.className];
          let funcDecl: ast.FunctionDeclaration | null = null;
          for (const stmt of cls.body) {
            if (stmt.type === "FunctionDeclaration" && stmt.name.value === i.config.equalsMethodName) {
              funcDecl = stmt;
              break;
            }
          }
          if (funcDecl !== null) {
            const funcEnv = new Environment(i.globalEnv);
            funcEnv.this_ = left;
            funcEnv.declare("__selfClass__", left.className);
            if (funcDecl.params.length > 0) funcEnv.declare(funcDecl.params[0].name.value, right);
            const result = checkReturn(i, funcDecl, await execBlock(i, funcDecl.body.statements, funcEnv));
            if (expr.operator === "!=" && typeof result === "boolean") return !result;
            return result;
          }
        }
        return expr.operator === "==" ? left === right : left !== right;
      }

      switch (expr.operator) {
        case "+":
        case "-":
        case "*":
        case "/":
        case "%":
        case ">":
        case "<":
        case ">=":
        case "<=":
          break;
        default:
          throw new RuntimeError(Codes.UnknownOperator, expr.operator);
      }

      // Null-safe (Runtime spec 2.4): only the equality operators may see 비어있음.
      if (left === null || left === undefined || right === null || right === undefined) {
        throw new RuntimeError(Codes.NullOperand, expr.operator);
      }

      if (typeof left === "number" && typeof right === "number") {
        switch (expr.operator) {
          case "+":
            return left + right;
          case "-":
            return left - right;
          case "*":
            return left * right;
          case "/":
            if (right === 0) throw new RuntimeError(Codes.DivideByZero);
            return left / right;
          case "%":
            if (Math.trunc(right) === 0) throw new RuntimeError(Codes.DivideByZero);
            return Math.trunc(left) % Math.trunc(right);
          case ">":
            return left > right;
          case "<":
            return left < right;
          case ">=":
            return left >= right;
          case "<=":
            return left <= right;
        }
      }

      // String addition only joins strings: no implicit conversion (Runtime spec 2.2).
      if (expr.operator === "+" && typeof left === "string" && typeof right === "string") {
        return left + right;
      }
      throw new RuntimeError(
        Codes.OperandTypeMismatch,
        expr.operator,
        describeType(i.config.types, left, i),
        describeType(i.config.types, right, i),
      );
    }
    default:
      return null;
  }
}
