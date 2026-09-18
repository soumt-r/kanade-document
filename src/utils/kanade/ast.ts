// Mirrors hana/ast/ast.go's node set field-for-field (camelCase instead of
// Go's exported PascalCase, TS's naming convention — Go has no json tags, so
// field *names* are the only contract to preserve, not their casing). Go
// tells Statement from Expression apart via a marker interface method
// (statementNode()/expressionNode()); TS has no equivalent, so every node
// carries an explicit `type` discriminant string instead (same node-type
// names Go's own type-switches branch on, e.g. "IfStatement").
//
// One deliberate structural change from a byte-for-byte port: Go's
// IfStatement has no `elifs` field — an "else if" is just another IfStatement
// nested inside Alternate (see parser/haja/parser.go's parseIfBody). The
// previous ad hoc TS engine flattened elif chains into an `elifs: []` array
// instead; this port follows Go's nested-Alternate shape so the interpreter
// only needs one IfStatement-evaluation path, not two.

export type Statement =
  | VariableDeclaration
  | Assignment
  | PrintStatement
  | InputStatement
  | ExpressionStatement
  | BlockStatement
  | SwitchStatement
  | FallthroughStatement
  | IfStatement
  | ReturnStatement
  | BreakStatement
  | ForEachLoop
  | ForRangeStatement
  | WhileLoop
  | ClassDeclaration
  | ImportStatement
  | InterfaceDeclaration
  | ListPushStatement
  | ListPopStatement
  | TryStatement
  | CatchClause
  | ThrowStatement
  | FunctionDeclaration
  | InterfaceMethod
  | ConstructorDeclaration;

export type Expression =
  | Identifier
  | SelfReference
  | SuperReference
  | StaticReference
  | NumberLiteral
  | StringLiteral
  | NullLiteral
  | FunctionReference
  | TypeReference
  | BooleanLiteral
  | TemplateLiteral
  | MemberExpression
  | CallExpression
  | NewExpression
  | BinaryExpression
  | LogicalExpression
  | ListLiteral
  | DictLiteral
  | ListPopExpression;

export type Node = Statement | Expression | Program;

export interface Program {
  type: "Program";
  statements: Statement[];
}

// ----------------------------------------------------
// 리터럴 & 식별자
// ----------------------------------------------------

export interface Identifier {
  type: "Identifier";
  value: string;
}

export interface SelfReference {
  type: "SelfReference";
}

export interface SuperReference {
  type: "SuperReference";
}

export interface StaticReference {
  type: "StaticReference";
}

export interface NumberLiteral {
  type: "NumberLiteral";
  value: number;
}

export interface StringLiteral {
  type: "StringLiteral";
  value: string;
}

export interface NullLiteral {
  type: "NullLiteral";
}

export interface FunctionReference {
  type: "FunctionReference";
  name: string;
}

export interface TypeReference {
  type: "TypeReference";
  name: string;
}

export interface BooleanLiteral {
  type: "BooleanLiteral";
  value: boolean;
}

export interface TemplateLiteral {
  type: "TemplateLiteral";
  value: string;
}

// ----------------------------------------------------
// 표현식 (Expressions)
// ----------------------------------------------------

export interface MemberExpression {
  type: "MemberExpression";
  object: Expression;
  property: Expression;
}

export interface CallExpression {
  type: "CallExpression";
  callee: Expression;
  arguments: Expression[];
}

export interface NewExpression {
  type: "NewExpression";
  class: TypeReference;
  arguments: Expression[];
}

export interface BinaryExpression {
  type: "BinaryExpression";
  left: Expression;
  operator: string;
  right: Expression;
}

// LogicalExpression is 그리고/또는 (AND/OR). Unlike BinaryExpression, its
// evaluation must short-circuit: right is only evaluated when left doesn't
// already determine the result.
export interface LogicalExpression {
  type: "LogicalExpression";
  left: Expression;
  operator: string; // "그리고" or "또는"
  right: Expression;
}

// ----------------------------------------------------
// 문장 (Statements)
// ----------------------------------------------------

export interface SetterInfo {
  param: Identifier | null;
  body: Statement[];
}

export interface VariableDeclaration {
  type: "VariableDeclaration";
  name: Identifier;
  typeRef: TypeReference | null;
  value: Expression | null;
  isConstant: boolean;
  accessModifier: string; // "public" | "private" | "protected"
  isStatic: boolean;
  getter: Statement[] | null;
  setter: SetterInfo | null;
}

export interface Assignment {
  type: "Assignment";
  target: Expression;
  value: Expression;
}

export interface PrintStatement {
  type: "PrintStatement";
  value: Expression;
  newLine: boolean;
}

export interface InputStatement {
  type: "InputStatement";
  target: Identifier | null;
  typeRef: TypeReference | null;
}

export interface ExpressionStatement {
  type: "ExpressionStatement";
  expression: Expression;
}

export interface BlockStatement {
  type: "BlockStatement";
  statements: Statement[];
}

export interface SwitchCase {
  tests: Expression[];
  consequent: BlockStatement;
  isDefault: boolean;
}

export interface SwitchStatement {
  type: "SwitchStatement";
  discriminant: Expression;
  cases: SwitchCase[];
}

export interface FallthroughStatement {
  type: "FallthroughStatement";
}

export interface IfStatement {
  type: "IfStatement";
  condition: Expression;
  consequent: BlockStatement;
  alternate: BlockStatement | null;
}

export interface ReturnStatement {
  type: "ReturnStatement";
  value: Expression | null;
}

export interface BreakStatement {
  type: "BreakStatement";
}

export interface ForEachLoop {
  type: "ForEachLoop";
  list: Expression;
  body: BlockStatement;
}

export interface ForRangeStatement {
  type: "ForRangeStatement";
  start: Expression;
  end: Expression;
  loopVar: string;
  body: BlockStatement;
}

export interface WhileLoop {
  type: "WhileLoop";
  condition: Expression;
  body: BlockStatement;
}

export interface ClassDeclaration {
  type: "ClassDeclaration";
  name: TypeReference;
  baseClass: TypeReference | null;
  interfaces: TypeReference[];
  body: Statement[];
}

// ImportStatement is `[모듈]에서 <이름>을 가져오자` (또는 `""에서`/`<이름>을
// <별칭>으로 가져오자`). `as` is "" unless the source used the renaming form.
export interface ImportStatement {
  type: "ImportStatement";
  module: string;
  target: string;
  as: string;
  isBuiltin: boolean;
}

export function importBindName(stmt: ImportStatement): string {
  return stmt.as !== "" ? stmt.as : stmt.target;
}

export interface InterfaceDeclaration {
  type: "InterfaceDeclaration";
  name: TypeReference;
  body: Statement[];
}

export interface ListLiteral {
  type: "ListLiteral";
  elements: Expression[];
}

export interface Property {
  key: Expression;
  value: Expression;
}

export interface DictLiteral {
  type: "DictLiteral";
  properties: Property[];
}

export interface ListPushStatement {
  type: "ListPushStatement";
  target: Expression;
  value: Expression;
  position: "front" | "back";
}

export interface ListPopExpression {
  type: "ListPopExpression";
  target: Expression;
  position: "front" | "back";
}

export interface ListPopStatement {
  type: "ListPopStatement";
  target: Expression;
  position: "front" | "back";
}

export interface TryStatement {
  type: "TryStatement";
  block: BlockStatement;
  handlers: CatchClause[];
  finalizer: BlockStatement | null;
}

export interface CatchClause {
  type: "CatchClause";
  errorType: TypeReference | null;
  param: Identifier;
  body: BlockStatement;
}

export interface ThrowStatement {
  type: "ThrowStatement";
  value: Expression;
}

export interface Parameter {
  name: Identifier;
  typeAnnotation: TypeReference | null;
  default: Expression | null;
}

export interface FunctionDeclaration {
  type: "FunctionDeclaration";
  name: Identifier;
  params: Parameter[];
  body: BlockStatement;
  accessModifier: string; // "public" | "private" | "protected"
  isStatic: boolean;
  returnType: TypeReference | null;
}

export interface InterfaceMethod {
  type: "InterfaceMethod";
  name: Identifier;
}

export interface ConstructorDeclaration {
  type: "ConstructorDeclaration";
  id: Identifier;
  params: Parameter[];
  body: Statement[];
}
