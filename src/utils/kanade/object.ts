// Mirrors hana/vm/object.go: no single tagged-union runtime Value type — Go
// leans on `interface{}` + a type-switch at each use site, plus a family of
// small unrelated wrapper structs for "a name bound to something callable".
// This port keeps that shape: runtime values are plain JS
// number/string/boolean/null/Array/Map/Record, narrowed with `instanceof`
// against these classes exactly where Go would type-switch on its structs.
import type { Expression } from "./ast";

export class HajaObject {
  className: string;
  props: Record<string, unknown> = {};

  constructor(className: string) {
    this.className = className;
  }
}

export class BoundMethod {
  constructor(
    public object: HajaObject,
    public funcName: string,
    public isSuper = false,
  ) {}
}

export type BuiltinFn = (env: unknown, ...args: unknown[]) => unknown | Promise<unknown>;

export class BuiltinFunction {
  constructor(
    public name: string,
    public fn: BuiltinFn,
  ) {}
}

export class BoundStringMethod {
  constructor(
    public value: string,
    public funcName: string,
  ) {}
}

export class BoundListMethod {
  // target is the MemberExpression's Object expression the list came from —
  // needed because a mutating list method (비우기) has to write the result
  // back to wherever it came from (mirrors assignListBack's own doc comment
  // in listOps.ts, kept here for the same reason Go's object.go keeps it).
  constructor(
    public list: unknown[],
    public funcName: string,
    public target: Expression | null,
  ) {}
}

export class BoundStaticMethod {
  constructor(
    public className: string,
    public funcName: string,
  ) {}
}

export class SuperReferenceValue {
  constructor(public object: HajaObject) {}
}

// ClassReference는 클래스 자체를 값으로 취급할 때 씁니다 (정적 멤버 접근, instanceof 등).
export class ClassReference {
  constructor(public className: string) {}
}

// NativeModule은 네이티브로 구현된 내장 모듈(예: [수학])이 노출하는 함수 테이블입니다.
export type NativeModule = Record<string, BuiltinFunction>;
