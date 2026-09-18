// Mirrors hana/vm/interpreter.go's Interpreter: NewInterpreter, Run()
// (declaration collection -> interface pre-flight validation -> execution),
// FormatValue. Constructor also takes the browser Playground's
// inputCallback/outputCallback (Go's interpreter has no such concept — it
// prints straight to stdout — so these two fields plus `inlineBuffer` are
// this port's one addition beyond a structural mirror, carried over from the
// previous ad hoc engine to keep index.ts's public contract unchanged).
import * as ast from "./ast";
import { Environment } from "./env";
import { HajaObject } from "./object";
import { type LangConfig, JapaneseConfig } from "./config";
import { evaluateNode } from "./evalExpr";
import { executeStmt } from "./execStmt";
import { KanadeRuntimeError } from "./errors";
import { RuntimeError, Codes, localize } from "./errs";
import { BuiltinFunction, type BuiltinFn, type NativeModule } from "./object";

export class KanadeInterpreter {
  ast: ast.Program;
  globalEnv: Environment;
  classes: Record<string, ast.ClassDeclaration> = {};
  interfaces: Record<string, ast.InterfaceDeclaration> = {};
  output: string[] = [];
  config: LangConfig;
  nativeModules: Record<string, NativeModule> = {};
  inlineBuffer = "";
  inputCallback?: (promptText: string) => Promise<string>;
  outputCallback?: (msg: string) => void;

  constructor(
    prog: ast.Program,
    inputCallback?: (promptText: string) => Promise<string>,
    outputCallback?: (msg: string) => void,
    config: LangConfig = JapaneseConfig,
  ) {
    this.ast = prog;
    this.globalEnv = new Environment(null);
    this.config = config;
    this.inputCallback = inputCallback;
    this.outputCallback = outputCallback;
    this.classes[config.builtinErrorClass] = newBuiltinErrorClass(config);
  }

  // Mirrors Interpreter.RegisterBuiltin/RegisterNativeModule — stdlib.ts's
  // registerStandardLibrary calls these the same way hana/stdlib's
  // RegisterStandardLibrary calls the Go versions.
  registerBuiltin(name: string, fn: BuiltinFn): void {
    this.globalEnv.declare(name, new BuiltinFunction(name, fn));
  }

  registerNativeModule(name: string, module: NativeModule): void {
    this.nativeModules[name] = module;
  }

  async run(): Promise<string> {
    // 1. 선언부 수집
    for (const stmt of this.ast.statements) {
      if (stmt.type === "ClassDeclaration") {
        this.classes[stmt.name.name] = stmt;
      }
      if (stmt.type === "InterfaceDeclaration") {
        this.interfaces[stmt.name.name] = stmt;
      }
    }

    try {
      // 2. 인터페이스 검증 (Pre-flight Validation)
      for (const clsName in this.classes) {
        const cls = this.classes[clsName];
        for (const ifaceRef of cls.interfaces) {
          const iface = this.interfaces[ifaceRef.name];
          if (!iface) continue;
          for (const reqStmt of iface.body) {
            if (reqStmt.type === "InterfaceMethod") {
              const implemented = cls.body.some(
                (clsStmt) => clsStmt.type === "FunctionDeclaration" && clsStmt.name.value === reqStmt.name.value,
              );
              if (!implemented) {
                throw new RuntimeError(Codes.InterfaceNotImplemented, clsName, ifaceRef.name, reqStmt.name.value);
              }
            }
          }
        }
      }

      // 3. 실행
      for (const stmt of this.ast.statements) {
        if (stmt.type === "ClassDeclaration") {
          for (const clsStmt of stmt.body) {
            if (clsStmt.type === "VariableDeclaration" && clsStmt.isStatic) {
              const val = await evaluateNode(this, clsStmt.value, this.globalEnv);
              this.globalEnv.declare(`${stmt.name.name}.${clsStmt.name.value}`, val);
            } else if (clsStmt.type === "Assignment" && clsStmt.target.type === "MemberExpression") {
              const mem = clsStmt.target;
              if (mem.object.type === "Identifier" && this.config.pluralSelfWords.includes(mem.object.value)) {
                if (mem.property.type === "Identifier") {
                  const val = await evaluateNode(this, clsStmt.value, this.globalEnv);
                  this.globalEnv.declare(`${stmt.name.name}.${mem.property.value}`, val);
                }
              }
            }
          }
        } else if (stmt.type === "InterfaceDeclaration") {
          // 스킵
        } else {
          await executeStmt(this, stmt, this.globalEnv);
        }
      }
    } catch (e) {
      if (e instanceof KanadeRuntimeError) throw e;
      throw new KanadeRuntimeError(localize(this.config.locale, e));
    }

    if (this.inlineBuffer !== "") {
      this.output.push(this.inlineBuffer);
    }
    return this.output.join("\n");
  }

  formatValue(val: unknown): string {
    if (val === null || val === undefined) return this.config.nullString;
    if (typeof val === "string") return val;
    if (val instanceof HajaObject) return this.config.objectFormat.replace("%s", val.className);
    if (typeof val === "boolean") return val ? this.config.trueString : this.config.falseString;
    if (Array.isArray(val)) return "[" + val.map((el) => this.formatValue(el)).join(", ") + "]";
    if (val instanceof Map) {
      // Sorted by displayed key, like hana's Go FormatValue (Go maps have no
      // insertion order), so both engines print a dictionary identically.
      const entries = Array.from(val.entries())
        .map(([k, v]) => `${this.formatValue(k)}: ${this.formatValue(v)}`)
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      return "{" + entries.join(", ") + "}";
    }
    if (typeof val === "number") {
      // Go 쪽은 %v/%g가 3628800 같은 값도 과학적 표기법으로 바꿔버려서
      // strconv.FormatFloat(v, 'f', -1, 64)로 직접 처리해야 했지만, JS의
      // 기본 String(number)는 1e21 미만에서는 과학적 표기법을 쓰지 않으므로
      // 별도 처리가 필요 없다.
      return String(val);
    }
    return String(val);
  }
}

// newBuiltinErrorClass는 모든 인터프리터 인스턴스에 기본으로 존재하는 [오류] 클래스를
// 만듭니다. 소스를 파싱하지 않고 AST를 직접 구성하는 이유는 인터프리터 초기화
// 시점에 파서에 의존하고 싶지 않기 때문입니다 (Go 쪽과 동일한 이유).
function newBuiltinErrorClass(cfg: LangConfig): ast.ClassDeclaration {
  const self = (prop: string): ast.MemberExpression => ({
    type: "MemberExpression",
    object: { type: "Identifier", value: cfg.selfWords[0] },
    property: { type: "Identifier", value: prop },
  });

  return {
    type: "ClassDeclaration",
    name: { type: "TypeReference", name: cfg.builtinErrorClass },
    baseClass: null,
    interfaces: [],
    body: [
      {
        type: "VariableDeclaration",
        name: { type: "Identifier", value: cfg.builtinErrorMessage },
        typeRef: null,
        value: { type: "StringLiteral", value: "" },
        isConstant: false,
        accessModifier: "public",
        isStatic: false,
        getter: null,
        setter: null,
      },
      {
        type: "ConstructorDeclaration",
        id: { type: "Identifier", value: "__init__" },
        params: [{ name: { type: "Identifier", value: cfg.builtinErrorCtorArg }, typeAnnotation: null, default: null }],
        body: [
          {
            type: "Assignment",
            target: self(cfg.builtinErrorMessage),
            value: { type: "Identifier", value: cfg.builtinErrorCtorArg },
          },
        ],
      },
      {
        type: "FunctionDeclaration",
        name: { type: "Identifier", value: "__toString__" },
        params: [],
        accessModifier: "public",
        isStatic: false,
        returnType: null,
        body: {
          type: "BlockStatement",
          statements: [{ type: "ReturnStatement", value: self(cfg.builtinErrorMessage) }],
        },
      },
    ],
  };
}
