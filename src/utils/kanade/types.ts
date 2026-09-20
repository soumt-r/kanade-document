// Mirrors hana/vm/types.go: where the interpreter enforces declared types
// (Runtime spec 2.2) — on declarations, later assignments (the type outlives the
// declaration), list pushes, typed parameters and class fields.
import * as ast from "./ast";
import type { KanadeInterpreter } from "./interpreter";
import { Environment } from "./env";
import { HajaObject } from "./object";
import { checkType, checkArgumentType, checkReturnType, describe, type TypeHost, type TypeNames } from "./typecheck";
import { RuntimeError, Codes } from "./errs";

class InterpreterTypeHost implements TypeHost {
  constructor(private i: KanadeInterpreter) {}

  classOf(v: unknown): string | null {
    return v instanceof HajaObject ? v.className : null;
  }

  // True when cls is target, extends it, or (at any level of the chain)
  // declares that it follows it as an interface.
  isSubtype(cls: string, target: string): boolean {
    let current: string | null = cls;
    while (current) {
      if (current === target) return true;
      const decl: ast.ClassDeclaration | undefined = this.i.classes[current];
      if (!decl) return false;
      if (decl.interfaces.some((iface) => iface.name === target)) return true;
      current = decl.baseClass ? decl.baseClass.name : null;
    }
    return false;
  }
}

// describeType names a value's type in the language's words (for operator errors).
// requireBool is a condition's value: only true and false are conditions.
export function requireBool(v: unknown, i: KanadeInterpreter): boolean {
  if (typeof v === "boolean") return v;
  throw new RuntimeError(Codes.ConditionNotBoolean, describeType(i.config.types, v, i));
}

export function describeType(names: TypeNames, v: unknown, i: KanadeInterpreter): string {
  return describe(names, v, host(i));
}

function host(i: KanadeInterpreter): TypeHost {
  return new InterpreterTypeHost(i);
}

// fieldAnnotation finds the type a class (or an ancestor) declared for a field.
export function fieldAnnotation(i: KanadeInterpreter, className: string, prop: string): string | undefined {
  let current: string | null = className;
  while (current) {
    const decl: ast.ClassDeclaration | undefined = i.classes[current];
    if (!decl) return undefined;
    for (const stmt of decl.body) {
      if (stmt.type === "VariableDeclaration" && !stmt.isStatic && stmt.name.value === prop) {
        return stmt.typeRef ? stmt.typeRef.name : undefined;
      }
    }
    current = decl.baseClass ? decl.baseClass.name : null;
  }
  return undefined;
}

// declaredTypeOf resolves name the way Environment.assign does and returns the
// type it was declared with, if any.
export function declaredTypeOf(i: KanadeInterpreter, env: Environment, name: string): string | undefined {
  const owner = env.ownerOf(name);
  if (owner === null) return undefined;
  if (owner instanceof HajaObject) return fieldAnnotation(i, owner.className, name);
  return owner.declaredType(name);
}

// checkDeclaredType enforces the type an existing variable or field was
// declared with.
export function checkDeclaredType(i: KanadeInterpreter, env: Environment, name: string, val: unknown): void {
  const declared = declaredTypeOf(i, env, name);
  if (declared !== undefined) checkType(i.config.types, declared, name, val, host(i));
}

// checkField enforces a class field's declared type on a write.
export function checkField(i: KanadeInterpreter, obj: HajaObject, prop: string, val: unknown): void {
  const annotation = fieldAnnotation(i, obj.className, prop);
  if (annotation !== undefined) checkType(i.config.types, annotation, prop, val, host(i));
}

// assignVariable is where a `정하자` statement writes a variable: check against
// this statement's annotation and against the type an earlier declaration
// gave the variable, then assign — or declare a new one, remembering the type.
export function assignVariable(
  i: KanadeInterpreter,
  env: Environment,
  name: string,
  val: unknown,
  annotation: string,
  isConst: boolean,
): void {
  if (annotation !== "") checkType(i.config.types, annotation, name, val, host(i));
  const declared = declaredTypeOf(i, env, name);
  if (declared !== undefined && declared !== annotation) checkType(i.config.types, declared, name, val, host(i));

  const [assigned, err] = env.assign(name, val);
  if (err) throw err;
  if (assigned) return;
  if (isConst) env.declareConst(name, val);
  else env.declare(name, val);
  if (annotation !== "") env.declareType(name, annotation);
}

// declareParam binds one argument to its parameter, enforcing the parameter's
// declared type, which then keeps constraining assignments inside the body.
export function declareParam(i: KanadeInterpreter, env: Environment, param: ast.Parameter, val: unknown): void {
  if (param.typeAnnotation) {
    checkArgumentType(i.config.types, param.typeAnnotation.name, param.name.value, val, host(i));
    env.declare(param.name.value, val);
    env.declareType(param.name.value, param.typeAnnotation.name);
    return;
  }
  env.declare(param.name.value, val);
}

// checkReturn enforces a function's declared return type, if it wrote one.
export function checkReturn(i: KanadeInterpreter, fn: ast.FunctionDeclaration, val: unknown): unknown {
  if (fn.returnType) checkReturnType(i.config.types, fn.returnType.name, fn.name.value, val, host(i));
  return val;
}

// checkInitialField checks a field's default value when an object is created.
export function checkInitialField(i: KanadeInterpreter, stmt: ast.VariableDeclaration, val: unknown): void {
  if (stmt.typeRef) checkType(i.config.types, stmt.typeRef.name, stmt.name.value, val, host(i));
}
