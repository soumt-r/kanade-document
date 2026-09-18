// Mirrors hana/vm/exec_stmt.go's Execute — one dispatch over every
// ast.Statement variant. Two structural notes vs. a byte-for-byte port:
//
//  1. Go threads control flow (return/break/throw) through `error` return
//     values; this port throws ReturnSignal/BreakSignal/ThrownSignal instead
//     and lets native try/catch/finally do the unwinding — which is also why
//     TryStatement below reads far more directly than exec_stmt.go's manual
//     error-type-switching version, while producing the identical semantics
//     (typed catch matching, finally always runs, a finally error overwrites
//     the one it's catching).
//  2. PrintStatement/InputStatement do real I/O here (outputCallback/
//     inputCallback) since that's this engine's entire reason to exist — Go's
//     versions are a stdout-print and a test-env stub respectively (see
//     hana/vm/exec_stmt.go's InputStatement case, which just declares "").
import * as ast from "./ast";
import type { KanadeInterpreter } from "./interpreter";
import { Environment } from "./env";
import { evaluateNode, execBlock } from "./evalExpr";
import { popFromList, assignListBack } from "./listOps";
import { findInClassChain, thrownValueMatchesType } from "./classLookup";
import { HajaObject, ClassReference } from "./object";
import { ReturnSignal, BreakSignal, ThrownSignal } from "./errors";

export async function executeStmt(i: KanadeInterpreter, stmt: ast.Statement, env: Environment): Promise<void> {
  switch (stmt.type) {
    case "ThrowStatement": {
      const val = await evaluateNode(i, stmt.value, env);
      throw new ThrownSignal(val);
    }
    case "TryStatement": {
      let pending: unknown = null;
      try {
        for (const bs of stmt.block.statements) await executeStmt(i, bs, env);
      } catch (e) {
        if (e instanceof ReturnSignal || e instanceof BreakSignal) {
          // return/break는 catch로 잡지 않지만 finally는 실행한다 (아래).
          pending = e;
        } else {
          let matchedHandler: ast.CatchClause | null = null;
          for (const h of stmt.handlers) {
            if (h.errorType === null || thrownValueMatchesType(i, e, h.errorType.name)) {
              matchedHandler = h;
              break;
            }
          }
          if (matchedHandler !== null) {
            const catchEnv = new Environment(env);
            let errObj: HajaObject;
            if (e instanceof ThrownSignal && e.value instanceof HajaObject) {
              errObj = e.value;
            } else {
              errObj = new HajaObject(i.config.builtinErrorClass);
              const msg = e instanceof ThrownSignal ? String(e.value) : e instanceof Error ? e.message : String(e);
              errObj.props[i.config.builtinErrorMessage] = msg;
            }
            catchEnv.declare(matchedHandler.param.value, errObj);
            try {
              for (const bs of matchedHandler.body.statements) await executeStmt(i, bs, catchEnv);
            } catch (e2) {
              pending = e2;
            }
          } else {
            // 핸들러가 하나도 안 맞으면 그대로 흘려보낸다 — finally를 거친 뒤
            // 다시 던져져야 한다.
            pending = e;
          }
        }
      }

      if (stmt.finalizer) {
        try {
          for (const bs of stmt.finalizer.statements) await executeStmt(i, bs, env);
        } catch (finErr) {
          // finally에서의 에러가 기존 에러를 덮어씀
          pending = finErr;
        }
      }

      if (pending !== null) throw pending;
      return;
    }
    case "ListPushStatement": {
      const targetVal = await evaluateNode(i, stmt.target, env);
      if (!Array.isArray(targetVal)) throw new Error("TypeError: Not a list.");
      const pushVal = await evaluateNode(i, stmt.value, env);
      const newList = stmt.position === "front" ? [pushVal, ...targetVal] : [...targetVal, pushVal];
      await assignListBack(i, stmt.target, newList, env);
      return;
    }
    case "ListPopStatement": {
      const targetVal = await evaluateNode(i, stmt.target, env);
      if (!Array.isArray(targetVal)) throw new Error("TypeError: Not a list.");
      if (targetVal.length === 0) throw new Error("IndexOutOfBoundsError: The list is empty.");
      const [, newList] = popFromList(targetVal, stmt.position);
      await assignListBack(i, stmt.target, newList, env);
      return;
    }
    case "ReturnStatement": {
      const val = stmt.value !== null ? await evaluateNode(i, stmt.value, env) : null;
      throw new ReturnSignal(val);
    }
    case "BreakStatement":
      throw new BreakSignal();
    case "ImportStatement":
      // 웹 놀이터에서는 외부 파일(모듈) 가져오기를 지원하지 않는다 — Go의
      // vm/import.go(파일시스템·DLL FFI)는 브라우저 새시박스에 적용 불가.
      throw new Error("웹 놀이터에서는 외부 파일(모듈) 가져오기를 아직 지원하지 않아요.");
    case "VariableDeclaration": {
      const val = await evaluateNode(i, stmt.value, env);
      if (stmt.isStatic) {
        const [clsName, exists] = env.get("__selfClass__");
        if (exists && typeof clsName === "string") {
          i.globalEnv.declare(`${clsName}.${stmt.name.value}`, val);
        }
      } else {
        const [assigned, err] = env.assign(stmt.name.value, val);
        if (err) throw err;
        if (!assigned) {
          if (stmt.isConstant) env.declareConst(stmt.name.value, val);
          else env.declare(stmt.name.value, val);
        }
      }
      return;
    }
    case "InputStatement": {
      const typeAnn = stmt.typeRef ? stmt.typeRef.name : "文字列";
      if (!["文字列", "数字", "論理"].includes(typeAnn)) {
        throw new Error(`UnsupportedInputTypeError: '${typeAnn}'型は入力として受け取れません。`);
      }

      let userInput: string;
      if (i.inputCallback) {
        userInput = (await i.inputCallback("")) || "";
      } else {
        userInput = (typeof prompt === "function" ? prompt(`入力 (${typeAnn}): `) : "") || "";
      }

      let val: unknown = userInput;
      if (typeAnn === "数字") {
        const num = Number(userInput);
        if (Number.isNaN(num)) throw new Error(`InputConversionError: '${userInput}'を数字に変換できません。`);
        val = num;
      } else if (typeAnn === "論理") {
        if (userInput === i.config.trueString) val = true;
        else if (userInput === i.config.falseString) val = false;
        else throw new Error(`InputConversionError: '${userInput}'を真/偽に変換できません。`);
      }

      i.inlineBuffer = "";
      if (stmt.target) {
        const [assigned] = env.assign(stmt.target.value, val);
        if (!assigned) env.declare(stmt.target.value, val);
      }
      return;
    }
    case "PrintStatement": {
      const val = i.formatValue(await evaluateNode(i, stmt.value, env));
      if (stmt.newLine) {
        i.output.push(i.inlineBuffer + val);
        i.outputCallback?.(val + "\n");
        i.inlineBuffer = "";
      } else {
        i.inlineBuffer += val;
        i.outputCallback?.(val);
      }
      return;
    }
    case "ForEachLoop": {
      let listVal: unknown;
      let itemName: string;

      // README: ForEachLoop AST엔 별도 "순회 변수" 필드가 없다 — 파서가
      // `'목록'의 '항목'마다 반복하자`를 MemberExpression{목록, 항목}로 파싱해
      // 넘기므로, 여기서 그 모양을 감지해 항목 변수명을 꺼낸다 (하나의 AST
      // 모양이 두 가지 역할을 겸하는 지점 — Go도 동일하게 처리한다).
      if (stmt.list.type === "MemberExpression") {
        listVal = await evaluateNode(i, stmt.list.object, env);
        itemName = stmt.list.property.type === "Identifier" ? stmt.list.property.value : i.config.defaultItemName;
      } else {
        listVal = await evaluateNode(i, stmt.list, env);
        itemName = i.config.defaultItemName;
      }

      if (!Array.isArray(listVal)) throw new Error("TypeError: Not iterable.");
      for (const item of listVal) {
        const loopEnv = new Environment(env);
        loopEnv.declare(itemName, item);
        try {
          for (const bs of stmt.body.statements) await executeStmt(i, bs, loopEnv);
        } catch (e) {
          if (e instanceof BreakSignal) return;
          throw e;
        }
      }
      return;
    }
    case "WhileLoop": {
      for (;;) {
        const condVal = await evaluateNode(i, stmt.condition, env);
        if (!(typeof condVal === "boolean" && condVal)) break;

        const loopEnv = new Environment(env);
        try {
          for (const bs of stmt.body.statements) await executeStmt(i, bs, loopEnv);
        } catch (e) {
          if (e instanceof BreakSignal) return;
          throw e;
        }
      }
      return;
    }
    case "ForRangeStatement": {
      const startVal = await evaluateNode(i, stmt.start, env);
      const endVal = await evaluateNode(i, stmt.end, env);
      if (typeof startVal !== "number" || typeof endVal !== "number") {
        throw new Error("TypeError: Range must be numbers.");
      }
      const step = startVal > endVal ? -1 : 1;
      for (let v = startVal; step > 0 ? v <= endVal : v >= endVal; v += step) {
        const loopEnv = new Environment(env);
        if (stmt.loopVar !== "") loopEnv.declare(stmt.loopVar, v);
        else loopEnv.declare(i.config.defaultIndexName, v);
        try {
          for (const bs of stmt.body.statements) await executeStmt(i, bs, loopEnv);
        } catch (e) {
          if (e instanceof BreakSignal) return;
          throw e;
        }
      }
      return;
    }
    case "ExpressionStatement": {
      await evaluateNode(i, stmt.expression, env);
      return;
    }
    case "SwitchStatement": {
      const val = await evaluateNode(i, stmt.discriminant, env);

      let matched = false;
      let fallthroughNext = false;
      for (const c of stmt.cases) {
        if (!matched && !fallthroughNext) {
          if (c.isDefault) {
            matched = true;
          } else {
            for (const t of c.tests) {
              const testVal = await evaluateNode(i, t, env);
              if (val === testVal) {
                matched = true;
                break;
              }
            }
          }
        } else if (fallthroughNext) {
          matched = true;
          fallthroughNext = false;
        }

        if (matched) {
          for (const s of c.consequent.statements) {
            if (s.type === "FallthroughStatement") {
              fallthroughNext = true;
              break;
            }
            await executeStmt(i, s, env);
          }
          if (fallthroughNext) continue;
          break;
        }
      }
      return;
    }
    case "FallthroughStatement":
      return;
    case "IfStatement": {
      const cond = await evaluateNode(i, stmt.condition, env);
      if (typeof cond === "boolean" && cond) {
        for (const bs of stmt.consequent.statements) await executeStmt(i, bs, env);
      } else if (stmt.alternate !== null) {
        for (const bs of stmt.alternate.statements) await executeStmt(i, bs, env);
      }
      return;
    }
    case "Assignment": {
      const val = await evaluateNode(i, stmt.value, env);

      if (stmt.target.type === "Identifier") {
        const [, err] = env.assign(stmt.target.value, val);
        if (err) throw err;
        return;
      }
      if (stmt.target.type === "MemberExpression") {
        const mem = stmt.target;
        const obj = await evaluateNode(i, mem.object, env);

        if (obj instanceof HajaObject) {
          if (mem.property.type === "Identifier") {
            const cls = i.classes[obj.className];
            let setter: ast.SetterInfo | null = null;
            findInClassChain(i, cls, (body) => {
              for (const s of body) {
                if (s.type === "VariableDeclaration" && s.name.value === (mem.property as ast.Identifier).value) {
                  setter = s.setter;
                  return true;
                }
              }
              return false;
            });

            if (setter !== null) {
              const setterEnv = new Environment(i.globalEnv);
              setterEnv.this_ = obj;
              setterEnv.declare("this", obj);
              setterEnv.declare("__selfClass__", obj.className);
              if ((setter as ast.SetterInfo).param) {
                setterEnv.declare((setter as ast.SetterInfo).param!.value, val);
              }
              await execBlock(i, (setter as ast.SetterInfo).body, setterEnv);
            } else {
              obj.props[mem.property.value] = val;
            }
          }
        } else if (Array.isArray(obj)) {
          let idx = -1;
          if (mem.property.type === "NumberLiteral") {
            idx = mem.property.value - 1;
          } else {
            const propVal = await evaluateNode(i, mem.property, env).catch(() => undefined);
            if (typeof propVal === "number") idx = propVal - 1;
          }
          if (idx >= 0 && idx < obj.length) obj[idx] = val;
        } else if (obj instanceof Map) {
          const propVal = await evaluateNode(i, mem.property, env).catch(() => undefined);
          if (propVal !== undefined) obj.set(propVal, val);
          else if (mem.property.type === "Identifier") obj.set(mem.property.value, val);
        } else if (obj instanceof ClassReference) {
          const propName = mem.property.type === "Identifier" ? mem.property.value : "";
          if (propName !== "") i.globalEnv.declare(`${obj.className}.${propName}`, val);
        }
      }
      return;
    }
    default:
      // 지원 안 하는 문법 무시 (ClassDeclaration/InterfaceDeclaration/
      // FunctionDeclaration은 interpreter.ts의 run()이 선언부 단계에서 따로
      // 처리하고 여기까지 오지 않는다 — Go의 vm/interpreter.go Run()과 동일).
      return;
  }
}
