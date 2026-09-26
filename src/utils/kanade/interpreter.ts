// Mirrors hana/vm/interpreter.go's Interpreter: NewInterpreter, Run()
// (declaration collection -> interface pre-flight validation -> execution),
// FormatValue. Constructor also takes the browser Playground's
// inputCallback/outputCallback (Go's interpreter has no such concept — it
// prints straight to stdout — so these two fields plus `inlineBuffer` are
// this port's one addition beyond a structural mirror, carried over from the
// previous ad hoc engine to keep index.ts's public contract unchanged).
import * as ast from "./ast";
import { Environment } from "./env";
import { HariObject } from "./object";
import { type LangConfig, JapaneseConfig } from "./config";
import { evaluateNode } from "./evalExpr";
import { executeStmt } from "./execStmt";
import { KanadeRuntimeError, ReturnSignal } from "./errors";
import { RuntimeError, Codes, localize } from "./errs";
import { BuiltinFunction, type BuiltinFn, type NativeModule } from "./object";

export class KanadeInterpreter {
  callDepth = 0;
  ast: ast.Program;
  globalEnv: Environment;
  classes: Record<string, ast.ClassDeclaration> = {};
  interfaces: Record<string, ast.InterfaceDeclaration> = {};
  output: string[] = [];
  config: LangConfig;
  nativeModules: Record<string, NativeModule> = {};
  // Modules hana has but a browser cannot run (files, sockets): importing one is an error.
  nativeOnlyModules = new Set<string>();
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

  registerNativeOnlyModule(name: string): void {
    this.nativeOnlyModules.add(name);
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
          try {
            await executeStmt(this, stmt, this.globalEnv);
          } catch (e) {
            // 최상위의 돌려주자는 프로그램을 끝낸다 (Go 엔진과 같음).
            if (e instanceof ReturnSignal) break;
            throw e;
          }
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
    if (val instanceof HariObject) return this.config.objectFormat.replace("%s", val.className);
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
    if (typeof val === "number") return plainNumber(val);
    return String(val);
  }
}

// plainNumber prints a number the way Go's FormatFloat(v, 'f', -1, 64) does: the
// shortest digits that read back exactly, never in scientific notation (JS's
// String() switches to it from 1e21 up and below 1e-6).
function plainNumber(n: number): string {
  const s = String(n);
  const m = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
  if (!m) return s;
  const [, sign, whole, frac = "", exp] = m;
  const digits = whole + frac;
  const shift = Number(exp) + whole.length;
  if (shift >= digits.length) return sign + digits + "0".repeat(shift - digits.length);
  if (shift > 0) return sign + digits.slice(0, shift) + "." + digits.slice(shift);
  return sign + "0." + "0".repeat(-shift) + digits;
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
    isAbstract: false,
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
