// Mirrors hana/vm/object.go: no single tagged-union runtime Value type — Go
// leans on `interface{}` + a type-switch at each use site, plus a family of
// small unrelated wrapper structs for "a name bound to something callable".
// This port keeps that shape: runtime values are plain JS
// number/string/boolean/null/Array/Map/Record, narrowed with `instanceof`
// against these classes exactly where Go would type-switch on its structs.
import type { Expression } from "./ast";

export class HariObject {
  className: string;
  props: Record<string, unknown> = {};

  constructor(className: string) {
    this.className = className;
  }
}

export class BoundMethod {
  constructor(
    public object: HariObject,
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
  // a list held by a constant variable cannot be emptied (mirrors Go's object.go).
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
  constructor(public object: HariObject) {}
}

// ClassReference는 클래스 자체를 값으로 취급할 때 씁니다 (정적 멤버 접근, instanceof 등).
export class ClassReference {
  constructor(public className: string) {}
}

// NativeModule은 네이티브로 구현된 내장 모듈(예: [수학])이 노출하는 함수 테이블입니다.
export type NativeModule = Record<string, BuiltinFunction>;
