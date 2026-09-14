export class KanadeError extends Error {
  line: number;
  col: number;
  length: number;

  constructor(msg: string, line: number, col: number, length: number = 1) {
    super(msg);
    this.name = 'KanadeError';
    this.line = line;
    this.col = col;
    this.length = length;
  }
}

export class KanadeRuntimeError extends Error {
  line: number;
  hajaObj?: any;

  constructor(msg: string, line: number, hajaObj?: any) {
    super(msg);
    this.name = 'KanadeRuntimeError';
    this.line = line;
    this.hajaObj = hajaObj;
  }
}

export class MathError extends KanadeRuntimeError {
  constructor(msg: string, line: number) {
    super(msg, line);
    this.name = 'MathError';
  }
}

export class DivideByZeroError extends MathError {
  constructor(msg: string, line: number) {
    super(msg, line);
    this.name = 'DivideByZeroError';
  }
}

export class IndexOutOfBoundsError extends KanadeRuntimeError {
  constructor(msg: string, line: number) {
    super(msg, line);
    this.name = 'IndexOutOfBoundsError';
  }
}

export class KeyError extends KanadeRuntimeError {
  constructor(msg: string, line: number) {
    super(msg, line);
    this.name = 'KeyError';
  }
}

export class ConversionError extends KanadeRuntimeError {
  constructor(msg: string, line: number) {
    super(msg, line);
    this.name = 'ConversionError';
  }
}

export class ImmutableAssignmentError extends KanadeRuntimeError {
  constructor(msg: string, line: number) {
    super(msg, line);
    this.name = 'ImmutableAssignmentError';
  }
}

export interface Token {
  type: string;
  value: string;
  line: number;
  col: number;
}

export interface Program {
  type: "Program";
  body: ASTNode[];
}

export interface VariableDeclaration {
  type: "VariableDeclaration";
  target: ASTNode;
  isStatic: boolean;
  accessModifier: "public" | "private" | "protected";
  typeAnnotation: TypeReference | null;
  value: ASTNode | null;
  isConst: boolean;
  isDeclarationOnly: boolean;
  getter: ASTNode[] | null;
  setter: {
    param: Identifier;
    body: ASTNode[];
  } | null;
}

export interface CompoundAssignment {
  type: "CompoundAssignment";
  operator: string;
  target: ASTNode;
  value: ASTNode;
}

export interface ListPushStatement {
  type: "ListPushStatement";
  target: ASTNode;
  value: ASTNode;
  position: "front" | "back";
}

export interface ListPopStatement {
  type: "ListPopStatement";
  target: ASTNode;
  position: "front" | "back";
}

export interface ListPopExpression {
  type: "ListPopExpression";
  target: ASTNode;
  position: "front" | "back";
}

export interface IfStatement {
  type: "IfStatement";
  condition: ASTNode;
  consequent: ASTNode[];
  elifs: { condition: ASTNode; consequent: ASTNode[] }[];
  alternate: ASTNode[] | null;
}

export interface SwitchStatement {
  type: "SwitchStatement";
  discriminant: ASTNode;
  cases: { values: ASTNode[]; body: ASTNode[] }[];
  default: ASTNode[] | null;
}

export interface FallthroughStatement {
  type: "FallthroughStatement";
}

export interface WhileLoop {
  type: "WhileLoop";
  condition: ASTNode;
  body: ASTNode[];
}

export interface ForEachLoop {
  type: "ForEachLoop";
  item: Identifier;
  iterable: ASTNode;
  body: ASTNode[];
}

export interface ForRangeStatement {
  type: "ForRangeStatement";
  start: ASTNode;
  end: ASTNode;
  iterator: Identifier;
  body: ASTNode[];
}

export interface BreakStatement {
  type: "BreakStatement";
}

export interface FunctionDeclaration {
  type: "FunctionDeclaration";
  id: string;
  isStatic: boolean;
  accessModifier: "public" | "private" | "protected";
  returnType: TypeReference | null;
  isAbstract: boolean;
  params: { type: TypeReference | null; name: string; default: ASTNode | null }[];
  body: ASTNode[] | null;
}

export interface ReturnStatement {
  type: "ReturnStatement";
  value: ASTNode | null;
}

export interface ClassDeclaration {
  type: "ClassDeclaration";
  id: string;
  typeParams: string[];
  isAbstract: boolean;
  baseClass: TypeReference | null;
  interfaces: TypeReference[];
  body: ASTNode[];
}

export interface ConstructorDeclaration {
  type: "ConstructorDeclaration";
  id: Identifier;
  params: { type: TypeReference | null; name: string; default: ASTNode | null }[];
  body: ASTNode[];
}

export interface InterfaceDeclaration {
  type: "InterfaceDeclaration";
  id: string;
  body: InterfaceMethod[];
}

export interface InterfaceMethod {
  type: "InterfaceMethod";
  id: string;
  returnType: TypeReference | null;
  params: { type: TypeReference | null; name: string; default: ASTNode | null }[];
}

export interface BinaryExpression {
  type: "BinaryExpression";
  left: ASTNode;
  operator: string;
  right: ASTNode;
}

export interface LogicalExpression {
  type: "LogicalExpression";
  left: ASTNode;
  operator: "그리고" | "또는";
  right: ASTNode;
}

export interface CallExpression {
  type: "CallExpression";
  callee: ASTNode;
  arguments: ASTNode[];
}

export interface NewExpression {
  type: "NewExpression";
  callee: TypeReference;
  arguments: ASTNode[];
}

export interface MemberExpression {
  type: "MemberExpression";
  object: ASTNode;
  property: ASTNode;
}

export interface SuperReference {
  type: "SuperReference";
}

export interface OuterReference {
  type: "OuterReference";
}

export interface Identifier {
  type: "Identifier";
  name: string;
}

export interface FunctionReference {
  type: "FunctionReference";
  name: string | null;
  expression: ASTNode | null;
}

export interface ExpressionStatement {
  type: "ExpressionStatement";
  expression: ASTNode;
}

export interface TypeReference {
  type: "TypeReference";
  name: string;
  typeArgs: TypeReference[];
}

export interface Literal {
  type: "Literal";
  value: any;
  raw: string;
}

export interface TemplateLiteral {
  type: "TemplateLiteral";
  strings: string[];
  expressions: ASTNode[];
}

export interface ListLiteral {
  type: "ListLiteral";
  elements: ASTNode[];
}

export interface DictLiteral {
  type: "DictLiteral";
  elements: { key: ASTNode; value: ASTNode }[];
}

export interface IndexExpression {
  type: "IndexExpression";
  index: ASTNode;
}

export interface LengthLiteral {
  type: "LengthLiteral";
  value: string;
}

export interface ImportStatement {
  type: "ImportStatement";
  module: { kind: "user" | "builtin"; name: string };
  imports: string[] | null;
}

export interface TryStatement {
  type: "TryStatement";
  block: ASTNode[];
  handlers: CatchClause[];
  finalizer: ASTNode[] | null;
}

export interface CatchClause {
  type: "CatchClause";
  catchType: TypeReference | null;
  param: Identifier;
  body: ASTNode[];
}

export interface ThrowStatement {
  type: "ThrowStatement";
  error: ASTNode;
}

export interface PrintStatement {
  type: "PrintStatement";
  value: ASTNode;
}

export interface PrintInlineStatement {
  type: "PrintInlineStatement";
  value: ASTNode;
}

export interface InputStatement {
  type: "InputStatement";
  target: Identifier;
  typeAnnotation: TypeReference | null;
}

export type ASTNode =
  | Program
  | VariableDeclaration
  | CompoundAssignment
  | ListPushStatement
  | ListPopStatement
  | ListPopExpression
  | IfStatement
  | SwitchStatement
  | FallthroughStatement
  | WhileLoop
  | ForEachLoop
  | ForRangeStatement
  | BreakStatement
  | FunctionDeclaration
  | ReturnStatement
  | ClassDeclaration
  | ConstructorDeclaration
  | InterfaceDeclaration
  | InterfaceMethod
  | BinaryExpression
  | LogicalExpression
  | CallExpression
  | NewExpression
  | MemberExpression
  | SuperReference
  | OuterReference
  | Identifier
  | FunctionReference
  | ExpressionStatement
  | TypeReference
  | Literal
  | TemplateLiteral
  | ListLiteral
  | DictLiteral
  | IndexExpression
  | LengthLiteral
  | ImportStatement
  | TryStatement
  | CatchClause
  | ThrowStatement
  | PrintStatement
  | PrintInlineStatement
  | InputStatement;

export class BreakLoop extends Error {
  constructor() {
    super('BreakLoop');
    this.name = 'BreakLoop';
  }
}

export class ReturnValue extends Error {
  value: any;
  constructor(value: any) {
    super('ReturnValue');
    this.name = 'ReturnValue';
    this.value = value;
  }
}


