// Mirrors hana/parser/haja/parser.go method-for-method (parseStatement's
// lookahead dispatch, parseGenericSov's SOV verb-collection dispatch,
// parseExpression -> parseMemberAndCall -> parsePrimary precedence chain).
// Unlike Go's Parser (which takes an injected LangProfile so parser/kanade
// can reuse it), this repo hardwires kanadeProfile directly — see
// langProfile.ts's header comment for why.
import * as ast from "./ast";
import * as tok from "./token";
import type { Token } from "./token";
import { Lexer } from "./lexer";
import { kanadeProfile, literalIn, LoopKind, type Component, type LangProfile } from "./langProfile";

// A parse problem with its position (1-based line, 0-based column in UTF-16
// units). The parser recovers and keeps going, so problems are collected -
// mirrors parser/haja's Diagnostic in hana.
export interface ParseDiagnostic {
  line: number;
  col: number;
  length: number;
  literal: string; // empty means the parser ran off the end of the input
}

export class Parser {
  private tokens: Token[];
  private pos = 0;
  private diags: ParseDiagnostic[] = [];
  // The `[타입]인 값` annotation parsePrimary just consumed; the SOV loop moves it
  // onto the component so a declaration can keep it (mirrors parser/haja).
  private declaredType: ast.TypeReference | null = null;
  private lang: LangProfile = kanadeProfile;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(offset = 0): Token | null {
    return this.pos + offset < this.tokens.length ? this.tokens[this.pos + offset] : null;
  }

  private consume(): Token {
    const t = this.tokens[this.pos];
    this.pos++;
    return t;
  }

  // What to report. Running off the end of the input is usually fallout of an
  // earlier bad token, so it is included only when nothing better explains it,
  // and only once.
  get diagnostics(): ParseDiagnostic[] {
    const real = this.diags.filter((d) => d.literal !== "");
    if (real.length === 0 && this.diags.length > 0) return [this.diags[0]];
    return real;
  }

  private lastContentLine(): number {
    for (let i = this.tokens.length - 1; i >= 0; i--) {
      const type = this.tokens[i].type;
      if (type !== tok.EOF && type !== tok.INDENT && type !== tok.DEDENT) return this.tokens[i].line;
    }
    return 1;
  }

  parseProgram(): ast.Program {
    const statements: ast.Statement[] = [];
    while (this.peek() !== null && this.peek()!.type !== tok.EOF) {
      const t = this.peek()!.type;
      if (t === tok.DEDENT || t === tok.INDENT) {
        this.consume();
        continue;
      }
      const stmt = this.parseStatement();
      if (stmt) statements.push(stmt);
    }
    return { type: "Program", statements };
  }

  private parseBlock(): ast.BlockStatement {
    const statements: ast.Statement[] = [];
    let t = this.peek();
    if (t && t.type === tok.COLON) this.consume();
    t = this.peek();
    if (t && t.type === tok.INDENT) {
      this.consume();
      for (;;) {
        const cur = this.peek();
        if (!cur || cur.type === tok.DEDENT || cur.type === tok.EOF) break;
        const stmt = this.parseStatement();
        if (stmt) statements.push(stmt);
      }
      if (this.peek() && this.peek()!.type === tok.DEDENT) this.consume();
    }
    return { type: "BlockStatement", statements };
  }

  private parseStatement(): ast.Statement | null {
    const t = this.peek();
    if (!t || t.type === tok.EOF) return null;
    if (t.type === tok.INDENT || t.type === tok.DEDENT) {
      if (t.type === tok.INDENT) this.consume();
      return null;
    }

    if (t.type === tok.LBRACKET || t.type === tok.TYPE) {
      const savedPos = this.pos;
      let foundType = false;
      let isClass = false;
      let isIface = false;
      for (let i = this.pos; i < this.tokens.length; i++) {
        if (this.tokens[i].line !== t.line) break;
        if (this.tokens[i].type === tok.COLON || this.tokens[i].type === tok.KW_FROM || this.tokens[i].type === tok.KW_IMPORT) break;
        if (this.tokens[i].type === tok.KW_CLASS || this.tokens[i].type === tok.KW_IMPLEMENTS) {
          foundType = true;
          isClass = true;
          break;
        }
        if (this.tokens[i].type === tok.KW_INTERFACE) {
          foundType = true;
          isIface = true;
          break;
        }
      }
      if (foundType) {
        if (isClass) return this.parseClass();
        if (isIface) return this.parseInterface();
      }
      this.pos = savedPos;
    }

    let isFuncDecl = false;
    const startLine = t.line;
    for (let i = this.pos; i < this.tokens.length; i++) {
      const ti = this.tokens[i];
      if (ti.line !== startLine) break;
      if (ti.type === tok.COLON || ti.type === tok.DEDENT || ti.type === tok.INDENT) break;
      if (ti.type === tok.FUNCTION) {
        if (i + 1 < this.tokens.length) {
          let nextIdx = i + 1;
          if (this.tokens[nextIdx].type === tok.PARTICLE) nextIdx++;
          if (nextIdx < this.tokens.length && (this.tokens[nextIdx].type === tok.KW_MAKE || this.tokens[nextIdx].type === tok.KW_MUST_HAVE)) {
            isFuncDecl = true;
            break;
          }
        }
      }
    }
    if (isFuncDecl) return this.parseFunctionDecl();

    if (t.type === tok.KW_IF) return this.parseIf();
    if (t.type === tok.KW_CONSTRUCT) return this.parseConstructor();
    if (t.type === tok.KW_BREAK) {
      this.consume();
      return { type: "BreakStatement" };
    }
    if (t.type === tok.KW_RETURN) {
      this.consume();
      return { type: "ReturnStatement", value: null };
    }
    if (t.type === tok.KW_TRY) return this.parseTry();

    // Property declaration with getter/setter?
    let hasSetter = false;
    for (let i = 0; this.peek(i) !== null && this.peek(i)!.line === t.line && this.peek(i)!.type !== tok.EOF; i++) {
      if (this.peek(i)!.type === tok.COLON) {
        if (i > 0 && this.peek(i - 1)!.type === tok.KW_MAKE) {
          hasSetter = true;
          break;
        }
      }
    }
    if (hasSetter) return this.parsePropertyDeclaration();

    return this.parseGenericSov();
  }

  private parsePropertyDeclaration(): ast.VariableDeclaration {
    const expr = this.parsePrimary();
    const name = expr.type === "Identifier" ? expr : ({ type: "Identifier", value: "" } as ast.Identifier);

    if (this.peek() && this.peek()!.type === tok.PARTICLE) this.consume();

    const typeRef = this.parseTypeRef();

    if (this.peek() && this.peek()!.type === tok.PARTICLE) this.consume();

    this.consume(); // 정할 때
    this.consume(); // :

    if (this.peek() && this.peek()!.type === tok.INDENT) this.consume();

    let getter: ast.Statement[] | null = null;
    let setter: ast.SetterInfo | null = null;

    while (this.peek() !== null && this.peek()!.type !== tok.DEDENT && this.peek()!.type !== tok.EOF) {
      const cur = this.peek()!;
      if (cur.type === tok.KW_GETTER) {
        this.consume(); // 가져올 때
        this.consume(); // :
        getter = this.parseBlock().statements;
      } else if (cur.type === tok.KW_SETTER) {
        this.consume(); // 정할 때
        let param: ast.Identifier | null = null;
        if (this.peek() && this.peek()!.type === tok.LPAREN) {
          this.consume(); // (
          const p = this.parsePrimary();
          if (p.type === "Identifier") param = p;
          this.consume(); // )
        }
        this.consume(); // :
        setter = { param, body: this.parseBlock().statements };
      } else {
        this.consume();
      }
    }

    if (this.peek() && this.peek()!.type === tok.DEDENT) this.consume();

    return {
      type: "VariableDeclaration",
      name,
      typeRef,
      value: null,
      isConstant: false,
      accessModifier: "public",
      isStatic: false,
      getter,
      setter,
    };
  }

  private parseTry(): ast.TryStatement {
    this.consume(); // 일단 해보자
    while (this.peek() !== null && this.peek()!.type !== tok.COLON) this.consume();
    const block = this.parseBlock();

    const handlers: ast.CatchClause[] = [];

    for (;;) {
      if (this.peek() === null) break;
      const startPos = this.pos;

      let errType: ast.TypeReference | null = null;
      if (this.peek()!.type === tok.TYPE) {
        errType = this.parseTypeRef();
      } else if (this.peek()!.type === tok.IDENT && literalIn(this.peek()!.literal, this.lang.errorLiterals)) {
        this.consume();
      } else if (this.peek()!.type !== tok.KW_CATCH) {
        break;
      }

      if (this.peek() && this.peek()!.type === tok.PARTICLE) this.consume();

      if (this.peek() === null || this.peek()!.type !== tok.KW_CATCH) {
        this.pos = startPos;
        break;
      }

      this.consume(); // 발생했다면
      let paramName = "";
      if (this.peek() && this.peek()!.type === tok.LPAREN) {
        this.consume(); // (
        if (this.peek() && (this.peek()!.type === tok.VAR || this.peek()!.type === tok.IDENT)) {
          const nameTok = this.consume();
          paramName = nameTok.literal;
          if (nameTok.type === tok.VAR) {
            paramName = paramName.slice(this.lang.delimLen, paramName.length - this.lang.delimLen);
          }
        }
        if (this.peek() && this.peek()!.type === tok.RPAREN) this.consume(); // )
      } else {
        paramName = "에러";
      }
      while (this.peek() !== null && this.peek()!.type !== tok.COLON) this.consume();
      const catchBlock = this.parseBlock();
      handlers.push({
        type: "CatchClause",
        errorType: errType,
        param: { type: "Identifier", value: paramName },
        body: catchBlock,
      });
    }

    let finalizer: ast.BlockStatement | null = null;
    if (this.peek() && this.peek()!.type === tok.KW_FINALLY) {
      this.consume(); // 마무리는 항상
      while (this.peek() !== null && this.peek()!.type !== tok.COLON) this.consume();
      finalizer = this.parseBlock();
    }

    return { type: "TryStatement", block, handlers, finalizer };
  }

  private parseTypeRef(): ast.TypeReference | null {
    if (this.peek()!.type === tok.TYPE) {
      const t = this.consume();
      let val = t.literal;
      if (val.startsWith(this.lang.typeOpen) && val.endsWith(this.lang.typeClose)) {
        val = val.slice(this.lang.delimLen, val.length - this.lang.delimLen);
      }
      return { type: "TypeReference", name: val };
    }
    if (this.peek()!.type === tok.LBRACKET) {
      this.consume(); // [
      const name = this.consume().literal;
      this.consume(); // ]
      return { type: "TypeReference", name };
    }
    return null;
  }

  private parseInterface(): ast.InterfaceDeclaration {
    const nameNode = this.parseTypeRef()!;
    if (this.peek()!.type === tok.PARTICLE) this.consume();
    this.consume(); // 규정하자
    const block = this.parseBlock();
    return { type: "InterfaceDeclaration", name: nameNode, body: block.statements };
  }

  private parseClass(): ast.ClassDeclaration {
    let baseClass: ast.TypeReference | null = null;
    const interfaces: ast.TypeReference[] = [];
    let nameNode: ast.TypeReference | null = null;
    let isAbstract = false;

    while (this.peek() !== null && this.peek()!.type !== tok.COLON && this.peek()!.type !== tok.DEDENT && this.peek()!.type !== tok.INDENT) {
      const t = this.peek()!;

      if (t.type === tok.TYPE || t.type === tok.LBRACKET) {
        const tNode = this.parseTypeRef()!;

        if (this.peek() && this.peek()!.type === tok.PARTICLE) this.consume();

        if (this.peek() && this.peek()!.type === tok.KW_BASE) {
          this.consume(); // 따라 하길 / 따라하고
          baseClass = tNode;
        } else if (this.peek() && this.peek()!.type === tok.KW_IMPLEMENTS) {
          this.consume(); // 따르는 / 갖추는
          interfaces.push(tNode);
        } else if (this.peek() && this.peek()!.type === tok.KW_CLASS) {
          nameNode = tNode;
          isAbstract = this.consume().literal.startsWith("下");
          break;
        } else {
          nameNode = tNode;
        }
      } else if (t.type === tok.KW_CLASS) {
        isAbstract = this.consume().literal.startsWith("下");
        break;
      } else {
        this.consume();
      }
    }

    while (this.peek() !== null && this.peek()!.type !== tok.COLON) this.consume();
    if (this.peek() && this.peek()!.type === tok.COLON) this.consume(); // :

    const block = this.parseBlock();
    return { type: "ClassDeclaration", name: nameNode!, baseClass, interfaces, body: block.statements, isAbstract };
  }

  private parseFunctionDecl(): ast.Statement {
    let returnType: ast.TypeReference | null = null;
    let isStatic = false;

    while (this.peek() !== null && this.peek()!.type !== tok.FUNCTION && this.peek()!.type !== tok.COLON) {
      const t = this.peek()!;
      if (t.type === tok.TYPE || t.type === tok.LBRACKET) {
        returnType = this.parseTypeRef();
      } else if (t.type === tok.VAR || t.type === tok.IDENT) {
        if (literalIn(t.literal, this.lang.pluralSelfWords)) isStatic = true;
        this.consume();
      } else {
        this.consume();
      }
    }

    const nameTok = this.consume();
    let name = nameTok.literal;
    name = name.slice(this.lang.delimLen, name.length - this.lang.delimLen); // FUNCTION 델리미터 제거
    if (this.peek() && this.peek()!.type === tok.PARTICLE) this.consume();
    const action = this.consume();

    if (this.peek() && this.peek()!.type === tok.LPAREN) this.consume(); // (

    const params: ast.Parameter[] = [];
    while (this.peek() !== null && this.peek()!.type !== tok.RPAREN) {
      const t = this.peek()!;
      let typeAnn: ast.TypeReference | null = null;
      if (t.type === tok.LBRACKET || t.type === tok.TYPE) {
        typeAnn = this.parseTypeRef();
        if (this.peek() && (this.peek()!.type === tok.TYPE_IN || this.peek()!.literal === this.lang.typeInWord)) {
          this.consume(); // 인
        }
      }

      let paramName: ast.Identifier | null = null;
      if (this.peek() && (this.peek()!.type === tok.VAR || this.peek()!.type === tok.IDENT)) {
        const expr = this.parsePrimary();
        if (expr.type === "Identifier") paramName = expr;
      } else if (this.peek() && this.peek()!.type === tok.PARTICLE) {
        this.consume();
        continue;
      } else {
        this.consume(); // unknown
      }

      if (paramName !== null) {
        let defaultVal: ast.Expression | null = null;
        if (this.peek() && this.peek()!.type === tok.ASSIGN) {
          this.consume(); // =
          defaultVal = this.parseExpression();
        }
        params.push({ name: paramName, typeAnnotation: typeAnn, default: defaultVal });
      }

      if (this.peek() && (this.peek()!.literal === "," || this.peek()!.type === tok.PARTICLE)) this.consume();
    }
    if (this.peek() && this.peek()!.type === tok.RPAREN) this.consume(); // )

    const access = this.lang.accessModifierFromVerb(action.literal);

    if (action.type === tok.KW_MUST_HAVE) {
      return { type: "InterfaceMethod", name: { type: "Identifier", value: name } };
    }

    const block = this.parseBlock();
    return {
      type: "FunctionDeclaration",
      name: { type: "Identifier", value: name },
      params,
      body: block,
      accessModifier: access,
      isStatic,
      returnType,
    };
  }

  private parseIf(): ast.IfStatement {
    this.consume(); // 만약
    return this.parseIfBody();
  }

  // parseIfBody parses everything after the leading if-keyword: condition,
  // block, and any else/else-if tail. Split out from parseIf so KW_ELIF
  // (unused by this lexer, kept for structural parity — see langProfile.ts's
  // header comment) can recurse into it directly.
  private parseIfBody(): ast.IfStatement {
    const cond = this.parseCondition();
    while (this.peek() !== null && this.peek()!.type !== tok.COLON) this.consume();
    const block = this.parseBlock();

    let alt: ast.BlockStatement | null = null;
    if (this.peek() && this.peek()!.type === tok.KW_ELSE) {
      this.consume(); // 그렇지 않다면 / 그렇지 않고
      if (this.peek() && this.peek()!.type === tok.KW_IF) {
        alt = { type: "BlockStatement", statements: [this.parseIf()] };
      } else {
        while (this.peek() !== null && this.peek()!.type !== tok.COLON) this.consume();
        alt = this.parseBlock();
      }
    } else if (this.peek() && this.peek()!.type === tok.KW_ELIF) {
      this.consume(); // もしくは
      alt = { type: "BlockStatement", statements: [this.parseIfBody()] };
    }

    return { type: "IfStatement", condition: cond, consequent: block, alternate: alt };
  }

  // parseCondition: one comparison/operand, optionally chained with
  // 그리고/또는 into a LogicalExpression, followed by an optional trailing
  // '라면'.
  private parseCondition(): ast.Expression {
    let cond = this.parseConditionOperand();

    while (this.peek() !== null && (this.peek()!.type === tok.KW_AND || this.peek()!.type === tok.KW_OR)) {
      const opTok = this.consume();
      const op = opTok.type === tok.KW_OR ? "또는" : "그리고";
      const right = this.parseConditionOperand();
      cond = { type: "LogicalExpression", left: cond, operator: op, right };
    }

    // '라면' 같은 식별자 무시
    if (this.peek() && this.peek()!.type === tok.IDENT && literalIn(this.peek()!.literal, this.lang.conditionThenWords)) {
      this.consume();
    }

    return cond;
  }

  // parseConditionOperand: a parenthesized (possibly compound) condition, or
  // one comparison in SVO (`A 가 B 보다 크다`) or SOV (`A B 크다`) word order.
  private parseConditionOperand(): ast.Expression {
    let cond: ast.Expression;

    if (this.peek() && this.peek()!.type === tok.LPAREN) {
      this.consume();
      cond = this.parseCondition();
      if (this.peek() && this.peek()!.type === tok.RPAREN) this.consume();
      return cond;
    }
    cond = this.parseExpression();
    if (this.peek() && this.peek()!.type === tok.PARTICLE) this.consume();

    const next = this.peek();
    if (
      next !== null &&
      next.type !== tok.COMPARE &&
      next.type !== tok.RPAREN &&
      next.type !== tok.COLON &&
      next.type !== tok.IDENT &&
      next.type !== tok.KW_AND &&
      next.type !== tok.KW_OR
    ) {
      // Possibly SOV: Left Right Compare
      const right = this.parseExpression();
      if (this.peek() && this.peek()!.type === tok.PARTICLE) this.consume();
      if (this.peek() && this.peek()!.type === tok.COMPARE) {
        const op = this.lang.normalizeCompareOpSOV(this.consume().literal);
        cond = { type: "BinaryExpression", left: cond, operator: op, right };
      }
    } else if (next !== null && next.type === tok.COMPARE) {
      // SVO: Left Compare Right
      const op = this.lang.normalizeCompareOpSVO(this.consume().literal);
      const right = this.parseExpression();
      cond = { type: "BinaryExpression", left: cond, operator: op, right };
    }

    return cond;
  }

  // listPosition normalizes a leading particle ("앞에"/"뒤에서") to the AST's
  // canonical "front"/"back" value.
  private listPosition(particles: string[]): "front" | "back" {
    if (particles.length > 0 && particles[0].includes(this.lang.frontMarker)) return "front";
    return "back";
  }

  private parseGenericSov(): ast.Statement | null {
    const components: Component[] = [];
    for (;;) {
      const t = this.peek();
      if (t === null) break;
      if (
        t.type === tok.KW_MAKE ||
        t.type === tok.KW_EXECUTE ||
        t.type === tok.KW_PRINT ||
        t.type === tok.KW_RETURN ||
        t.type === tok.KW_LOOP ||
        t.type === tok.KW_PUSH ||
        t.type === tok.KW_POP ||
        t.type === tok.KW_THROW ||
        t.type === tok.KW_MUST_HAVE ||
        t.type === tok.KW_IMPORT ||
        t.type === tok.KW_ADD ||
        t.type === tok.KW_SUB ||
        t.type === tok.KW_SWITCH ||
        t.type === tok.KW_FALLTHROUGH ||
        t.type === tok.KW_INPUT
      ) {
        break;
      }
      this.declaredType = null;
      const expr = this.parseExpression();
      const declared = this.declaredType;
      this.declaredType = null;
      const parts: string[] = [];
      while (
        this.peek() !== null &&
        (this.peek()!.type === tok.COMMA ||
          this.peek()!.type === tok.PARTICLE ||
          this.peek()!.type === tok.KW_FROM ||
          this.peek()!.type === tok.TYPE_IN ||
          this.peek()!.type === tok.KW_FRONT ||
          this.peek()!.type === tok.KW_BACK)
      ) {
        const consumed = this.consume();
        if (consumed.type === tok.PARTICLE || consumed.type === tok.KW_FRONT || consumed.type === tok.KW_BACK) {
          parts.push(consumed.literal);
        }
      }
      components.push({ expr, particles: parts, type: declared });
    }

    if (this.peek() === null || this.peek()!.type === tok.EOF) return null;
    const verb = this.consume();

    if (verb.type === tok.KW_ADD || verb.type === tok.KW_SUB) {
      const target = components[0].expr;
      const val = components[1].expr;
      const op = verb.type === tok.KW_SUB ? "-" : "+";
      return { type: "Assignment", target, value: { type: "BinaryExpression", left: target, operator: op, right: val } };
    }
    if (verb.type === tok.KW_MAKE) {
      const target = components[0].expr;
      const val: ast.Expression | null = components.length > 1 ? components[1].expr : null;
      const declared: ast.TypeReference | null = components.length > 1 ? components[1].type : null;

      const access = this.lang.accessModifierFromVerb(verb.literal);
      const isConst = this.lang.isConstVerb(verb.literal);

      if (target.type === "Identifier") {
        return {
          type: "VariableDeclaration",
          name: target,
          typeRef: declared,
          value: val,
          isConstant: isConst,
          accessModifier: access,
          isStatic: false,
          getter: null,
          setter: null,
        };
      } else if (target.type === "MemberExpression") {
        const isStaticRef = target.object.type === "StaticReference";
        const isQuotedStatic = target.object.type === "Identifier" && literalIn(target.object.value, this.lang.pluralSelfWords);
        if (isStaticRef || isQuotedStatic) {
          if (target.property.type === "Identifier") {
            return {
              type: "VariableDeclaration",
              name: target.property,
              typeRef: declared,
              value: val,
              isConstant: false,
              accessModifier: access,
              isStatic: true,
              getter: null,
              setter: null,
            };
          }
        }
        return { type: "Assignment", target, value: val! };
      } else {
        return { type: "Assignment", target, value: val! };
      }
    }
    if (verb.type === tok.KW_EXECUTE) {
      return { type: "ExpressionStatement", expression: components[0].expr };
    }
    if (verb.type === tok.KW_RETURN) {
      if (components.length > 0) return { type: "ReturnStatement", value: components[0].expr };
      return { type: "ReturnStatement", value: null };
    }
    if (verb.type === tok.KW_PRINT) {
      const newLine = !this.lang.isPrintInlineVerb(verb.literal);
      return { type: "PrintStatement", value: components[0].expr, newLine };
    }
    if (verb.type === tok.KW_LOOP) {
      let loopVar = "";
      if (this.peek() && this.peek()!.type === tok.LPAREN) {
        this.consume(); // (
        if (this.peek() && this.peek()!.type === tok.VAR) {
          loopVar = this.consume().literal;
          loopVar = loopVar.slice(this.lang.delimLen, loopVar.length - this.lang.delimLen);
        }
        if (this.peek() && this.peek()!.type === tok.RPAREN) this.consume(); // )
      }
      if (components.length >= 1) {
        switch (this.lang.classifyLoop(verb, components)) {
          case LoopKind.ForEach:
            return { type: "ForEachLoop", list: components[0].expr, body: this.parseBlock() };
          case LoopKind.While:
            return { type: "WhileLoop", condition: components[0].expr, body: this.parseBlock() };
          default:
            if (components.length >= 2) {
              return {
                type: "ForRangeStatement",
                start: components[0].expr,
                end: components[1].expr,
                loopVar,
                body: this.parseBlock(),
              };
            }
        }
      }
    }
    if (verb.type === tok.KW_PUSH) {
      if (components.length >= 2) {
        return {
          type: "ListPushStatement",
          target: components[0].expr,
          value: components[1].expr,
          position: this.listPosition(components[0].particles),
        };
      }
    }
    if (verb.type === tok.KW_POP) {
      if (components.length >= 1) {
        return { type: "ListPopStatement", target: components[0].expr, position: this.listPosition(components[0].particles) };
      }
    }
    if (verb.type === tok.KW_INPUT) {
      const targetExpr = components[0].expr;
      const targetId = targetExpr.type === "Identifier" ? targetExpr : null;
      let typeAnn: ast.TypeReference | null = null;
      if (components.length > 1 && components[1].expr.type === "TypeReference") {
        typeAnn = components[1].expr;
      }
      return { type: "InputStatement", target: targetId, typeRef: typeAnn };
    }
    if (verb.type === tok.KW_FALLTHROUGH) {
      return { type: "FallthroughStatement" };
    }
    if (verb.type === tok.KW_THROW) {
      if (components.length > 0) return { type: "ThrowStatement", value: components[0].expr };
    }
    if (verb.type === tok.KW_MUST_HAVE) {
      if (components.length > 0) {
        // 인터페이스 메서드 규정 - V1 단순화
        return { type: "ExpressionStatement", expression: components[0].expr };
      }
    }
    if (verb.type === tok.KW_SWITCH) {
      if (components.length > 0) {
        const cases: ast.SwitchCase[] = [];
        if (this.peek() && this.peek()!.type === tok.COLON) this.consume();
        if (this.peek() && this.peek()!.type === tok.INDENT) this.consume();
        while (this.peek() !== null && this.peek()!.type !== tok.DEDENT && this.peek()!.type !== tok.EOF) {
          if (this.peek()!.type === tok.INDENT) {
            this.consume();
            continue;
          }
          if (this.peek()!.type === tok.KW_DEFAULT) {
            this.consume(); // 나머지는
            if (this.peek() && this.peek()!.type === tok.COLON) this.consume();
            const cBody = this.parseBlock();
            cases.push({ tests: [], consequent: cBody, isDefault: true });
          } else {
            const tests: ast.Expression[] = [];
            while (this.peek() !== null) {
              if (this.peek()!.type === tok.TYPE_IN) {
                this.consume(); // 인
                if (this.peek() && this.peek()!.type === tok.KW_CASE) this.consume(); // 경우
                break;
              }
              if (this.peek()!.type === tok.KW_CASE) {
                this.consume(); // 場合
                break;
              }
              const expr = this.parseExpression();
              tests.push(expr);
              if (this.peek() && this.peek()!.type === tok.COMMA) this.consume();
            }
            if (this.peek() && this.peek()!.type === tok.COLON) this.consume();
            const cBody = this.parseBlock();
            cases.push({ tests, consequent: cBody, isDefault: false });
          }
        }
        if (this.peek() && this.peek()!.type === tok.DEDENT) this.consume();
        return { type: "SwitchStatement", discriminant: components[0].expr, cases };
      }
    }
    if (verb.type === tok.KW_IMPORT) {
      if (components.length >= 2) {
        let moduleName = "";
        let isBuiltin = false;

        const c0 = components[0].expr;
        if (c0.type === "Identifier") moduleName = c0.value;
        else if (c0.type === "StringLiteral") moduleName = c0.value;
        else if (c0.type === "TypeReference") {
          moduleName = c0.name;
          isBuiltin = true;
        } else if (c0.type === "ListLiteral" && c0.elements.length > 0 && c0.elements[0].type === "Identifier") {
          moduleName = c0.elements[0].value;
          isBuiltin = true;
        }

        const rest = components.slice(1);

        // `전부` alone, without a particle, imports the whole module.
        if (rest.length === 1 && rest[0].particles.length === 0) {
          const only = rest[0].expr;
          if (only.type === "Identifier" && only.value === this.lang.importAllWord) {
            return { type: "ImportStatement", module: moduleName, isBuiltin, all: true, items: [] };
          }
        }

        // `<이름>을 <별칭>으로`: a second component with the alias particle renames the first.
        if (rest.length === 2 && hasParticle(rest[1].particles, ...this.lang.importAsParticles)) {
          return {
            type: "ImportStatement", module: moduleName, isBuiltin, all: false,
            items: [{ name: importNameFromExpr(rest[0].expr), as: importNameFromExpr(rest[1].expr) }],
          };
        }
        const items = rest.map((comp) => ({ name: importNameFromExpr(comp.expr), as: "" }));
        return { type: "ImportStatement", module: moduleName, isBuiltin, all: false, items };
      }
    }

    return null;
  }

  parseExpression(): ast.Expression {
    let expr = this.parseMemberAndCall();

    for (;;) {
      const t = this.peek();
      if (t === null) break;
      if (t.type === tok.OP) {
        const op = this.consume().literal;
        const right = this.parseMemberAndCall();
        expr = { type: "BinaryExpression", left: expr, operator: op, right };
      } else {
        break;
      }
    }
    return expr;
  }

  private parseMemberAndCall(): ast.Expression {
    let expr = this.parsePrimary();

    for (;;) {
      const t = this.peek();
      if (t === null) break;
      if (
        t.type === tok.PARTICLE &&
        t.literal === this.lang.memberParticle &&
        this.peek(1) !== null &&
        this.peek(1)!.type === tok.IDENT &&
        this.peek(1)!.literal === this.lang.poppedValueWord
      ) {
        // 카나데는 인덱싱 뒤에 장식용 "の値"를 조사로 붙인다 — 여기서 감지해 건너뛴다.
        this.consume(); // の
        this.consume(); // 값/値
      } else if (
        t.type === tok.PARTICLE &&
        t.literal === this.lang.memberParticle &&
        !(this.peek(1) !== null && (this.peek(1)!.type === tok.KW_FRONT || this.peek(1)!.type === tok.KW_BACK))
      ) {
        this.consume();
        const prop = this.parsePrimary();
        expr = { type: "MemberExpression", object: expr, property: prop };
      } else if (t.type === tok.PARTICLE && t.literal === this.lang.memberParticle) {
        this.consume();
      } else if (t.type === tok.LPAREN) {
        this.consume(); // (
        const args: ast.Expression[] = [];
        while (this.peek() !== null && this.peek()!.type !== tok.RPAREN) {
          args.push(this.parseExpression());
          if (this.peek() && (this.peek()!.type === tok.COMMA || this.peek()!.type === tok.PARTICLE)) this.consume();
        }
        if (this.peek() && this.peek()!.type === tok.RPAREN) this.consume(); // )
        expr = { type: "CallExpression", callee: expr, arguments: args };
      } else if ((t.type === tok.KW_FRONT || t.type === tok.KW_BACK) && this.peek(1) !== null && this.peek(1)!.type === tok.KW_POPPED) {
        const pos: "front" | "back" = t.type === tok.KW_FRONT ? "front" : "back";
        this.consume(); // 앞에서/뒤에서
        this.consume(); // 꺼낸
        if (this.peek() && this.peek()!.type === tok.IDENT && this.peek()!.literal === this.lang.poppedValueWord) {
          this.consume(); // 값 (가독성용 옵션 토큰)
        }
        expr = { type: "ListPopExpression", target: expr, position: pos };
      } else {
        break;
      }
    }
    return expr;
  }

  private parsePrimary(): ast.Expression {
    const t = this.consume();
    if (t.type === tok.OP && t.literal === "-") {
      const next = this.consume();
      if (next.type === tok.INT) {
        return { type: "NumberLiteral", value: parseFloat("-" + next.literal) };
      }
      return { type: "StringLiteral", value: "알수없음: -" };
    }
    if (t.type === tok.STRING) {
      const val = t.literal.slice(this.lang.delimLen, t.literal.length - this.lang.delimLen);
      return { type: "StringLiteral", value: val };
    }
    if (t.type === tok.TEMPLATE_STRING) {
      let val = t.literal;
      if (val.startsWith(this.lang.templatePrefix)) val = val.slice(this.lang.templatePrefix.length);
      if (val.endsWith(this.lang.templateSuffix)) val = val.slice(0, val.length - this.lang.templateSuffix.length);
      return { type: "TemplateLiteral", value: val };
    }
    if (t.type === tok.VAR) {
      const val = t.literal.slice(this.lang.delimLen, t.literal.length - this.lang.delimLen);
      return { type: "Identifier", value: val };
    }
    if (t.type === tok.FUNCTION) {
      let val = t.literal.slice(this.lang.delimLen, t.literal.length - this.lang.delimLen);
      if (val === this.lang.constructorFunctionName) val = "__init__";
      return { type: "FunctionReference", name: val };
    }
    if (t.type === tok.KW_NULL) return { type: "NullLiteral" };
    if (t.type === tok.KW_TRUE) return { type: "BooleanLiteral", value: true };
    if (t.type === tok.KW_FALSE) return { type: "BooleanLiteral", value: false };
    if (t.type === tok.INT) return { type: "NumberLiteral", value: parseFloat(t.literal) };
    if (t.type === tok.KW_SELF) return { type: "SelfReference" };
    if (t.type === tok.KW_PARENT) return { type: "SuperReference" };
    if (t.type === tok.IDENT) {
      if (literalIn(t.literal, this.lang.pluralSelfWords)) return { type: "StaticReference" };
      return { type: "Identifier", value: t.literal };
    }
    if (t.type === tok.KW_NEW) {
      const cls = this.parseTypeRef()!;
      const args: ast.Expression[] = [];
      if (this.peek() && this.peek()!.type === tok.LPAREN) {
        this.consume(); // (
        while (this.peek() !== null && this.peek()!.type !== tok.RPAREN) {
          args.push(this.parseExpression());
          if (this.peek() && (this.peek()!.type === tok.COMMA || this.peek()!.type === tok.PARTICLE)) this.consume();
        }
        if (this.peek() && this.peek()!.type === tok.RPAREN) this.consume(); // )
      }
      return { type: "NewExpression", class: cls, arguments: args };
    }
    if (t.type === tok.TYPE) {
      let val = t.literal;
      if (val.startsWith(this.lang.typeOpen) && val.endsWith(this.lang.typeClose)) {
        val = val.slice(this.lang.delimLen, val.length - this.lang.delimLen);
      }
      const typeRef: ast.TypeReference = { type: "TypeReference", name: val };

      if (this.peek() && (this.peek()!.type === tok.TYPE_IN || this.peek()!.literal === this.lang.typeInWord)) {
        if (this.peek(1) !== null && this.peek(1)!.type === tok.TYPE) {
          this.consume(); // の
          return this.parsePrimary();
        }
        if (this.peek(1) !== null && this.peek(1)!.type === tok.FUNCTION) {
          this.consume(); // の
          const prop = this.parsePrimary();
          return { type: "MemberExpression", object: typeRef, property: prop };
        }
        this.consume(); // 인
        const res = this.parsePrimary();
        this.declaredType = typeRef;
        return res;
      }
      return typeRef;
    }
    if (t.type === tok.LBRACKET) {
      const elements: ast.Expression[] = [];
      while (this.peek() !== null && this.peek()!.type !== tok.RBRACKET) {
        elements.push(this.parseExpression());
        if (this.peek() && (this.peek()!.type === tok.COMMA || this.peek()!.type === tok.PARTICLE)) this.consume();
      }
      if (this.peek() && this.peek()!.type === tok.RBRACKET) this.consume();
      return { type: "ListLiteral", elements };
    }
    if (t.type === tok.LBRACE) {
      const properties: ast.Property[] = [];
      while (this.peek() !== null && this.peek()!.type !== tok.RBRACE) {
        const key = this.parseExpression();
        if (this.peek() && this.peek()!.type === tok.COLON) this.consume();
        const val = this.parseExpression();
        properties.push({ key, value: val });
        if (this.peek() && (this.peek()!.type === tok.COMMA || this.peek()!.type === tok.PARTICLE)) this.consume();
      }
      if (this.peek() && this.peek()!.type === tok.RBRACE) this.consume();
      return { type: "DictLiteral", properties };
    }
    if (t.type === tok.LPAREN) {
      const expr = this.parseCondition();
      if (this.peek() && this.peek()!.type === tok.RPAREN) this.consume();
      return expr;
    }
    this.diags.push({
      line: t.literal === "" ? this.lastContentLine() : t.line,
      col: t.col,
      length: Array.from(t.literal).length,
      literal: t.literal,
    });
    return { type: "StringLiteral", value: `알수없음: ${t.literal}` };
  }

  private parseConstructor(): ast.ConstructorDeclaration {
    this.consume();
    const params: ast.Parameter[] = [];
    if (this.peek() && this.peek()!.type === tok.LPAREN) {
      this.consume();
      while (this.peek() !== null && this.peek()!.type !== tok.RPAREN) {
        let typeAnn: ast.TypeReference | null = null;
        if (this.peek()!.type === tok.LBRACKET || this.peek()!.type === tok.TYPE) {
          typeAnn = this.parseTypeRef();
          if (this.peek() && (this.peek()!.type === tok.TYPE_IN || this.peek()!.literal === this.lang.typeInWord)) {
            this.consume();
          }
        }
        let paramName: ast.Identifier | null = null;
        if (this.peek() && this.peek()!.type === tok.VAR) {
          const expr = this.parsePrimary();
          if (expr.type === "Identifier") paramName = expr;
        } else {
          this.consume();
        }
        if (paramName !== null) {
          let defaultVal: ast.Expression | null = null;
          if (this.peek() && this.peek()!.type === tok.ASSIGN) {
            this.consume(); // =
            defaultVal = this.parseExpression();
          }
          params.push({ name: paramName, typeAnnotation: typeAnn, default: defaultVal });
        }
      }
      this.consume();
    }
    if (this.peek() && this.peek()!.type === tok.KW_DO_AS) this.consume();
    while (this.peek() !== null && this.peek()!.type !== tok.COLON) this.consume();
    const block = this.parseBlock();
    return { type: "ConstructorDeclaration", id: { type: "Identifier", value: this.lang.constructorFunctionName }, params, body: block.statements };
  }
}

// importNameFromExpr extracts a plain name from the shapes an import
// target/alias can take: a quoted identifier ('이름'), a plain string
// ("이름"), or a function reference (<이름>).
function importNameFromExpr(expr: ast.Expression): string {
  if (expr.type === "Identifier") return expr.value;
  if (expr.type === "StringLiteral") return expr.value;
  if (expr.type === "FunctionReference") return expr.name;
  return "";
}

function hasParticle(particles: string[], ...want: string[]): boolean {
  return particles.some((p) => want.includes(p));
}

// Kept for callers (evalExpr.ts's TemplateLiteral case) that need to lex+parse
// an embedded `{...}` expression the same way the top-level Lexer/Parser pair
// would.
export function parseExpressionFromSource(code: string): ast.Expression {
  const lexer = new Lexer(code);
  const parser = new Parser(lexer.tokens);
  return parser.parseExpression();
}
