// Mirrors hana/vm/env.go's Environment: a parent-pointer scope chain with a
// `this` fallback for instance-member lookup inside methods.
import { HariObject } from "./object";
import { RuntimeError, Codes } from "./errs";

export class Environment {
  private vars = new Map<string, unknown>();
  private constants = new Set<string>();
  private types = new Map<string, string>(); // declared [타입] per variable of this scope
  parent: Environment | null;
  this_: HariObject | null = null;

  constructor(parent: Environment | null) {
    this.parent = parent;
  }

  declare(name: string, value: unknown): void {
    this.vars.set(name, value);
  }

  declareConst(name: string, value: unknown): void {
    this.vars.set(name, value);
    this.constants.add(name);
  }

  // declareType records the type a variable declared in this scope was
  // annotated with; later assignments must keep honoring it.
  declareType(name: string, annotation: string): void {
    this.types.set(name, annotation);
  }

  declaredType(name: string): string | undefined {
    return this.types.get(name);
  }

  // ownerOf resolves name the way assign() does: the scope holding it as a
  // variable, else the object whose field it is, else further out.
  ownerOf(name: string): Environment | HariObject | null {
    if (this.vars.has(name)) return this;
    if (this.this_ !== null && Object.prototype.hasOwnProperty.call(this.this_.props, name)) return this.this_;
    return this.parent ? this.parent.ownerOf(name) : null;
  }

  isConst(name: string): boolean {
    if (this.constants.has(name)) return true;
    if (this.parent) return this.parent.isConst(name);
    return false;
  }

  // Returns [assigned, error] — mirrors Go's (bool, error) so callers can
  // tell "assigned to an existing binding" from "no such binding anywhere in
  // the chain, declare a new one instead".
  assign(name: string, value: unknown): [boolean, Error | null] {
    if (this.vars.has(name)) {
      if (this.isConst(name)) {
        return [false, new RuntimeError(Codes.ConstantAssignment, name)];
      }
      this.vars.set(name, value);
      return [true, null];
    }
    if (this.this_ !== null && Object.prototype.hasOwnProperty.call(this.this_.props, name)) {
      this.this_.props[name] = value;
      return [true, null];
    }
    if (this.parent) return this.parent.assign(name, value);
    return [false, null];
  }

  get(name: string): [unknown, boolean] {
    if (this.vars.has(name)) return [this.vars.get(name), true];
    if (this.this_ !== null && Object.prototype.hasOwnProperty.call(this.this_.props, name)) {
      return [this.this_.props[name], true];
    }
    if (this.parent) return this.parent.get(name);
    return [undefined, false];
  }
}
