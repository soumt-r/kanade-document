import { KanadeError, type Token, type ASTNode } from './types';
import { Lexer } from './lexer';

export class Parser {
  tokens: Token[];
  pos: number;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.pos = 0;
  }

  peek(offset = 0): Token | null {
    return this.pos + offset < this.tokens.length ? this.tokens[this.pos + offset] : null;
  }

  consume(expected_type?: string): Token {
    const tok = this.peek();
    if (!tok) {
      const prev = this.tokens.length > 0 ? this.tokens[this.tokens.length - 1] : { line: 1, col: 0, value: '', type: '' };
      throw new KanadeError("SyntaxError: コードが途中で途切れているようです。", prev.line, prev.col, 1);
    }
    if (expected_type && tok.type !== expected_type) {
      throw new KanadeError(`SyntaxError: [${expected_type}] 形式が必要ですが、不自然な値 '${tok.value}' が入ってきました。`, tok.line, tok.col, Math.max(1, tok.value.length));
    }
    this.pos += 1;
    return tok;
  }
  
  parse_type_reference(raw: string): ASTNode {
    const inner = raw.slice(1, -1);
    if (inner.startsWith('(')) {
      const end = inner.indexOf(')');
      const argsStr = inner.slice(1, end);
      const name = inner.slice(end + 1);
      const typeArgs = argsStr.split(',').map(s => ({ type: "TypeReference", name: s.trim(), typeArgs: [] }));
      return { type: "TypeReference", name, typeArgs };
    }
    return { type: "TypeReference", name: inner, typeArgs: [] };
  }

  parse_program(): ASTNode {
    const statements: ASTNode[] = [];
    while (this.peek()) {
      const stmt = this.parse_statement();
      if (stmt) statements.push(stmt);
    }
    return { type: "Program", body: statements };
  }

  parse_block(): ASTNode {
    this.consume('COLON');
    if (this.peek()?.type === 'INDENT') {
      this.consume('INDENT');
      const statements: ASTNode[] = [];
      while (this.peek() && this.peek()?.type !== 'DEDENT') {
        const stmt = this.parse_statement();
        if (stmt) statements.push(stmt);
      }
      if (this.peek()?.type === 'DEDENT') {
        this.consume('DEDENT');
      }
      return { type: "BlockStatement", body: statements };
    }
    return { type: "BlockStatement", body: [] };
  }

  _do_parse_statement(): ASTNode | null {
    const is_mod = this.peek()?.type === 'TYPE' || this.peek()?.type === 'STRING';
    if (is_mod && this.peek(1)?.value === 'から') {
      const mod_tok = this.consume();
      const mod = mod_tok.value.slice(1, -1);
      const is_builtin = mod_tok.type === 'TYPE';
      this.consume('PARTICLE');
      
      if (this.peek()?.type === 'KW_ALL') {
        this.consume('KW_ALL');
        this.consume('KW_IMPORT');
        return { type: "ImportStatement", module: { kind: is_builtin ? "builtin" : "user", name: mod }, imports: null };
      }
      
      const items = [];
      while (true) {
        const item_tok = this.consume();
        if (!['TYPE', 'FUNCTION', 'VARIABLE'].includes(item_tok.type)) {
          throw new Error(`SyntaxError: インポートする項目が正しくありません: ${item_tok.value}`);
        }
        const name = item_tok.value.slice(1, -1);
        items.push(name);
        
        const part = this.consume('PARTICLE');
        if (part.value === 'と' || part.value === 'と') continue;
        if ((part.value === 'を' || part.value === 'を') && this.peek()?.type === 'KW_IMPORT') {
          this.consume('KW_IMPORT');
          break;
        }
        throw new Error(`SyntaxError: 予期しない助詞がついています: ${part.value}`);
      }
      return { type: "ImportStatement", module: { kind: is_builtin ? "builtin" : "user", name: mod }, imports: items };
    }

    const tok = this.peek();
    if (!tok) return null;

    if (tok.type === 'INDENT' || tok.type === 'DEDENT') {
      this.consume();
      return null;
    }

    if (tok.type === 'TYPE') {
      const saved_pos = this.pos;
      this.pos += 1;
      if (this.peek()?.type === 'PARTICLE') this.pos += 1;
      const next_tok = this.peek();
      this.pos = saved_pos;

      if (next_tok?.type === 'KW_RETURN_TYPE') return this.parse_function_decl();
      if (next_tok?.type === 'KW_INTERFACE') return this.parse_interface();
      if (next_tok?.type === 'LPAREN') return this.parse_generic_sov();
      if (next_tok?.type === 'KW_CATCH') return this.parse_catch();
      return this.parse_class();
    }

    if (tok.type === 'FUNCTION') {
      const saved_pos = this.pos;
      this.pos += 1;
      if (this.peek()?.type === 'PARTICLE') this.pos += 1;
      const is_decl = this.peek()?.type === 'KW_FUNC' || this.peek()?.type === 'KW_REQUIRE';
      this.pos = saved_pos;
      if (is_decl) return this.parse_function_decl();
      return this.parse_generic_sov();
    }
    
    if (tok.type === 'VARIABLE' && tok.value === "『私たち』" && this.peek(1)?.type === 'PARTICLE' && this.peek(1)?.value === 'の' && this.peek(2)?.type === 'FUNCTION') {
      return this.parse_function_decl();
    }
    
    if (tok.type === 'KW_CATCH') return this.parse_catch();

    if (tok.type === 'KW_CONSTRUCT') return this.parse_constructor_decl();
    if (tok.type === 'KW_IF') return this.parse_if();
    if (tok.type === 'KW_TRY') return this.parse_try();
    if (tok.type === 'KW_FINALLY') throw new KanadeError("SyntaxError: '最後はいつも'은 반드시 'とりあえずやってみよう' 다음에 와야 해요.", tok.line, tok.col, Math.max(1, tok.value.length));
    
    let isForRange = false;
    for (let i = this.pos; i < this.tokens.length && this.tokens[i].type !== 'COLON' && this.tokens[i].line === tok.line; i++) {
      if (this.tokens[i].type === 'KW_TO') {
        isForRange = true;
        break;
      }
    }
    if (isForRange) return this.parse_for_range();
    if (tok.type === 'KW_BREAK') {
      this.consume();
      return { type: "BreakStatement" };
    }

    return this.parse_generic_sov();
  }

  parse_statement(): ASTNode | null {
    const tok = this.peek();
    if (!tok) return null;
    const line = tok.line;
    const node = this._do_parse_statement();
    if (node && typeof node === 'object') {
      node.line = line;
    }
    return node;
  }

  parse_interface(): ASTNode {
    const nameNode = this.parse_type_reference(this.consume('TYPE').value);
    if (this.peek()?.type === 'PARTICLE') this.consume();
    this.consume('KW_INTERFACE');
    const block = this.parse_block();
    return { type: "InterfaceDeclaration", id: nameNode.name, body: block.body };
  }

  parse_class(): ASTNode {
    let nameNode = null;
    let baseClass = null;
    const interfaces: any[] = [];
    
    while (this.peek() && this.peek()?.type !== 'KW_CLASS' && this.peek()?.type !== 'COLON') {
      if (this.peek()?.type === 'TYPE') {
        const typeNode = this.parse_type_reference(this.consume('TYPE').value);
        if (this.peek()?.type === 'PARTICLE') this.consume();
        
        if (this.peek()?.type === 'KW_BASE') {
          this.consume('KW_BASE');
          baseClass = typeNode;
        } else if (this.peek()?.type === 'KW_IMPLEMENTS') {
          this.consume('KW_IMPLEMENTS');
          interfaces.push(typeNode);
        } else {
          nameNode = typeNode;
        }
      } else {
        this.consume();
      }
    }
    
    let isAbstract = false;
    if (this.peek()?.type === 'KW_CLASS') {
      const kw = this.consume('KW_CLASS');
      if (kw.value.includes('規定しよう')) isAbstract = true;
    }
    
    const block = this.parse_block();
    return { 
      type: "ClassDeclaration", 
      id: nameNode ? nameNode.name : "不明", 
      typeParams: nameNode ? nameNode.typeArgs.map((x:any)=>x.name) : [],
      baseClass, 
      interfaces, 
      isAbstract,
      body: block.body 
    };
  }

  parse_function_decl(): ASTNode {
    let return_type = null;
    if (this.peek()?.type === 'TYPE') {
      return_type = this.parse_type_reference(this.consume('TYPE').value);
      if (this.peek()?.type === 'PARTICLE') this.consume();
      this.consume('KW_RETURN_TYPE');
    }
    
    let isStatic = false;
    if (this.peek()?.type === 'VARIABLE' && this.peek()?.value === "『私たち』" && this.peek(1)?.type === 'PARTICLE' && this.peek(1)?.value === 'の') {
      this.consume('VARIABLE');
      this.consume('PARTICLE');
      isStatic = true;
    }
    
    const name = this.consume('FUNCTION').value.slice(1, -1);
    if (this.peek()?.type === 'PARTICLE') this.consume();

    if (this.peek()?.type === 'TYPE' && this.peek(1)?.value === 'モジュールを' && this.peek(2)?.type === 'KW_IMPORT') {
      const mod = this.consume().value.slice(1, -1);
      this.consume('VARIABLE');
      this.consume('KW_IMPORT');
      return { type: "ImportStatement", module: { kind: "builtin", name: mod }, imports: null };
    }

    let action = null;
    if (this.peek()?.type === 'KW_FUNC') action = this.consume('KW_FUNC');
    else if (this.peek()?.type === 'KW_REQUIRE') action = this.consume('KW_REQUIRE');

    this.consume('LPAREN');
    const params = [];
    while (this.peek() && this.peek()?.type !== 'RPAREN') {
      let paramType = null;
      if (this.peek()?.type === 'TYPE') {
        paramType = this.parse_type_reference(this.consume('TYPE').value);
        if (this.peek()?.type === 'PARTICLE' && this.peek()?.value === 'の') this.consume('PARTICLE');
      }
      
      const paramName = this.consume('VARIABLE').value.slice(1, -1);
      let defaultVal = null;
      
      if (this.peek()?.type === 'ASSIGN_OP') {
        this.consume('ASSIGN_OP');
        defaultVal = this.parse_expression();
      }
      
      params.push({ type: paramType, name: paramName, default: defaultVal });
      
      if (this.peek()?.type === 'COMMA') this.consume('COMMA');
    }
    this.consume('RPAREN');

    if (action?.type === 'KW_REQUIRE') {
      return { type: "InterfaceMethod", id: name, returnType: return_type, params };
    }
    
    let isAbstract = false;
    let blockBody = null;
    if (this.peek()?.type === 'COLON') {
      const block = this.parse_block();
      blockBody = block.body;
    } else {
      isAbstract = true; // No body
    }

    const acc = action?.value.includes("隠そう") ? "private" : action?.value.includes("受け継ごう") ? "protected" : "public";
    return { type: "FunctionDeclaration", id: name, returnType: return_type, accessModifier: acc, params, body: blockBody, isStatic, isAbstract };
  }

  parse_constructor_decl(): ASTNode {
    this.consume('KW_CONSTRUCT');
    this.consume('LPAREN');
    const params: any[] = [];
    while (this.peek() && this.peek()?.type !== 'RPAREN') {
      let paramType = null;
      if (this.peek()?.type === 'TYPE') {
        paramType = this.parse_type_reference(this.consume('TYPE').value);
        if (this.peek()?.type === 'PARTICLE' && this.peek()?.value === 'の') this.consume('PARTICLE');
      }
      
      if (this.peek()?.type === 'VARIABLE') {
        const paramName = this.consume('VARIABLE').value.slice(1, -1);
        params.push({ type: paramType, name: paramName, default: null });
      }
      if (this.peek()?.type === 'COMMA') this.consume('COMMA');
    }
    this.consume('RPAREN');
    if (this.peek()?.type === 'KW_DO_AS') this.consume('KW_DO_AS');
    const block = this.parse_block();
    return { type: "ConstructorDeclaration", id: { type: "Identifier", name: "最初に作られる時" }, params, body: block.body };
  }

  parse_condition(): ASTNode {
    if (this.peek()?.type === 'LPAREN') {
      this.consume('LPAREN');
      const components = [];
      while (this.peek() && this.peek()?.type !== 'COMPARE' && this.peek()?.type !== 'RPAREN') {
        components.push(this.parse_expression());
        if (this.peek()?.type === 'PARTICLE') this.consume();
      }
      let cond_ast = components[0];
      if (this.peek()?.type === 'COMPARE') {
        let op = this.consume().value;
        if (op.includes('一種だ')) op = 'instanceof';
        else if (op.includes('同じだ') && op.includes('!')) op = '!=';
        else if (op.includes('同じだ')) op = '==';
        else if (op.includes('大きい')) op = '>';
        else if (op.includes('小さい')) op = '<';
        else if (op.includes('以上だ')) op = '>=';
        else if (op.includes('以下だ')) op = '<=';
        else if (op.includes('違う')) op = '!=';
        else if (op === '<' || op === '>' || op === '<=' || op === '>=' || op === '==' || op === '!=') {}
        
        const left = components[0];
        const right = components.length > 1 ? components[1] : null;
        cond_ast = { type: "BinaryExpression", operator: op, left, right };
      }
      this.consume('RPAREN');
      if (this.peek()?.type === 'LOGIC') {
        const logic = this.consume().value;
        const right_cond = this.parse_condition();
        return { type: "LogicalExpression", operator: logic, left: cond_ast, right: right_cond };
      }
      return cond_ast;
    }
    
    const expr = this.parse_expression();
    if (this.peek()?.type === 'LOGIC') {
        const logic = this.consume().value;
        const right_cond = this.parse_condition();
        return { type: "LogicalExpression", operator: logic, left: expr, right: right_cond };
    }
    return expr;
  }

  parse_if(): ASTNode {
    this.consume('KW_IF');
    const cond_ast = this.parse_condition();
    while (this.peek() && this.peek()?.type !== 'COLON') this.consume();
    const block = this.parse_block();
    const node: ASTNode = { type: "IfStatement", condition: cond_ast, consequent: block.body, elifs: [], alternate: null };
    
    while (this.peek()?.type === 'KW_ELIF') {
      this.consume('KW_ELIF');
      const elif_cond = this.parse_condition();
      while (this.peek() && this.peek()?.type !== 'COLON') this.consume();
      const elif_block = this.parse_block();
      node.elifs.push({ condition: elif_cond, consequent: elif_block.body });
    }

    if (this.peek()?.type === 'KW_ELSE') {
      this.consume('KW_ELSE');
      while (this.peek() && this.peek()?.type !== 'COLON') this.consume();
      const alt_block = this.parse_block();
      node.alternate = alt_block.body;
    }
    return node;
  }

  parse_try(): ASTNode {
    this.consume('KW_TRY');
    const block = this.parse_block();
    const node: ASTNode = { type: "TryStatement", block: block.body, handlers: [], finalizer: null };
    
    while (this.peek()?.type === 'TYPE' || this.peek()?.type === 'KW_CATCH') {
      node.handlers.push(this.parse_catch());
    }
    
    if (this.peek()?.type === 'KW_FINALLY') {
      this.consume('KW_FINALLY');
      const fin_block = this.parse_block();
      node.finalizer = fin_block.body;
    }
    return node;
  }

  parse_catch(): ASTNode {
    let catchType = null;
    if (this.peek()?.type === 'TYPE') {
      catchType = this.parse_type_reference(this.consume('TYPE').value);
      if (this.peek()?.type === 'PARTICLE') this.consume();
    }
    this.consume('KW_CATCH');
    let param = { type: "Identifier", name: "e" };
    if (this.peek()?.type === 'LPAREN') {
      this.consume('LPAREN');
      param = { type: "Identifier", name: this.consume('VARIABLE').value.slice(1, -1) };
      this.consume('RPAREN');
    }
    const block = this.parse_block();
    return { type: "CatchClause", catchType, param, body: block.body };
  }

  parse_for_range(): ASTNode {
    const start = this.parse_expression();
    const tok = this.consume(); if (tok.type !== 'KW_FROM' && tok.type !== 'PARTICLE') throw new Error('Expected KW_FROM or PARTICLE');
    const end = this.parse_expression();
    this.consume('KW_TO');
    
    let variable = { type: "Identifier", name: "回" };
    if (this.peek()?.type === 'LPAREN') {
      this.consume('LPAREN');
      variable = { type: "Identifier", name: this.consume('VARIABLE').value.slice(1, -1) };
      this.consume('RPAREN');
    }
    const block = this.parse_block();
    return { type: "ForRangeStatement", start, end, iterator: variable, body: block.body };
  }

  parse_primary(): ASTNode {
    const tok = this.peek();
    if (!tok) return { type: "Literal", value: null, raw: "" };

    if (['NUMBER', 'STRING'].includes(tok.type)) {
      const v = this.consume();
      return { type: "Literal", value: tok.type === 'NUMBER' ? Number(v.value) : v.value.slice(1, -1), raw: v.value };
    } else if (tok.type === 'BOOLEAN') {
      const v = this.consume();
      return { type: "Literal", value: v.value === '真', raw: v.value };
    } else if (tok.type === 'NULL') {
      const v = this.consume();
      return { type: "Literal", value: null, raw: v.value };
    } else if (tok.type === 'OP' && tok.value === '-') {
        this.consume('OP');
        if (this.peek()?.type === 'NUMBER') {
          const v = this.consume('NUMBER');
          return { type: "Literal", value: -Number(v.value), raw: '-' + v.value };
        }
        // If not a number, just return Literal(null) for now as fallback
        return { type: "Literal", value: null, raw: '-' };
      } else if (tok.type === 'FORMAT_STR') {
      const v = this.consume();
      const val = v.value.slice(2, -1);
      const parts = val.split(/(\{[^}]+\})/);
      const quasis: string[] = [];
      const expressions: ASTNode[] = [];
      for (const p of parts) {
        if (p.startsWith('{') && p.endsWith('}')) {
          const inner_code = p.slice(1, -1);
          const inner_lexer = new Lexer(inner_code);
          const inner_parser = new Parser(inner_lexer.tokens);
          expressions.push(inner_parser.parse_expression());
        } else {
          const unescaped = p.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
          quasis.push(unescaped);
        }
      }
      return { type: "TemplateLiteral", strings: quasis, expressions };
    } else if (tok.type === 'VARIABLE') {
      return { type: "Identifier", name: this.consume().value.slice(1, -1) };
    } else if (tok.type === 'FUNCTION') {
      const v = this.consume().value.slice(1, -1);
      if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith("『") && v.endsWith("』"))) {
        return { type: "FunctionReference", name: null, expression: { type: "Identifier", name: v.slice(1, -1) } };
      } else if (v.startsWith('"') && v.endsWith('"')) {
        return { type: "FunctionReference", name: null, expression: { type: "Literal", value: v.slice(1, -1), raw: v } };
      }
      return { type: "FunctionReference", name: v, expression: null };
    } else if (tok.type === 'KW_PARENT') {
      this.consume('KW_PARENT');
      return { type: "SuperReference" };
    } else if (tok.type === 'KW_OUTER') {
      this.consume('KW_OUTER');
      return { type: "OuterReference" };
    } else if (tok.type === 'KW_CONSTRUCT') {
      this.consume('KW_CONSTRUCT');
      return { type: "FunctionReference", name: "最初に作られる時", expression: null };
    } else if (tok.type === 'EMPTY_LIST') {
      this.consume();
      return { type: "ListLiteral", elements: [] };
    } else if (tok.type === 'LBRACKET') {
      this.consume('LBRACKET');
      const elements = [];
      while (this.peek() && this.peek()?.type !== 'RBRACKET') {
        elements.push(this.parse_expression());
        if (this.peek()?.type === 'COMMA') this.consume('COMMA');
      }
      this.consume('RBRACKET');
      return { type: "ListLiteral", elements };
    } else if (tok.type === 'EMPTY_DICT') {
      this.consume();
      return { type: "DictLiteral", elements: [] };
    } else if (tok.type === 'LBRACE') {
      this.consume('LBRACE');
      const elements = [];
      while (this.peek() && this.peek()?.type !== 'RBRACE') {
        const key = this.parse_expression();
        this.consume('COLON');
        const value = this.parse_expression();
        elements.push({ key, value });
        if (this.peek()?.type === 'COMMA') this.consume('COMMA');
      }
      this.consume('RBRACE');
      return { type: "DictLiteral", elements };
    } else if (tok.type === 'LPAREN') {
      const cond = this.parse_condition();
      return cond;
    } else if (tok.type === 'KW_NEW') {
      this.consume('KW_NEW');
      const t = this.consume('TYPE');
      if (this.peek()?.type === 'LPAREN') {
        this.consume('LPAREN');
        const args = this.parse_arguments();
        this.consume('RPAREN');
        return { type: "NewExpression", callee: this.parse_type_reference(t.value), arguments: args };
      } else {
        throw new Error(`SyntaxError: '新しい' 키워드 뒤에는 '[クラス名](...)' 형태가 필요해요.`);
      }
    } else if (tok.type === 'TYPE') {
      const t = this.consume();
      if (this.peek()?.type === 'LPAREN') {
        this.consume('LPAREN');
        const args = this.parse_arguments();
        this.consume('RPAREN');
        return { type: "NewExpression", callee: this.parse_type_reference(t.value), arguments: args };
      }
      return this.parse_type_reference(t.value);
    } else if (tok.type === 'KW_LENGTH') {
      return { type: "LengthLiteral", value: this.consume().value };
    } else if (tok.type === 'KW_POP' && this.peek(1)?.type === 'KW_VALUE') {
      // ListPopExpression handling could be tricky here because it's part of an expression
      // We parse generic components in generic_sov, but if it appears in primary...
      // Usually it's handled in statement level or member expr.
    }
    const val = this.consume();
    return { type: "Literal", value: null, raw: val.value };
  }

  parse_arguments(): ASTNode[] {
    const args = [];
    while (this.peek() && this.peek()?.type !== 'RPAREN') {
      args.push(this.parse_expression());
      if (this.peek()?.type === 'COMMA') this.consume('COMMA');
    }
    return args;
  }

  parse_expression(): ASTNode {
    // Check for ListPopExpression (e.g. `'リスト' (앞에서/뒤에서/에서) 꺼낸 값`)
    const savedPos = this.pos;
    if (this.peek()?.type === 'VARIABLE' || this.peek()?.type === 'KW_PARENT' || this.peek()?.type === 'KW_SELF') {
      let target = this.parse_primary();
      let isListPop = false;
      let pos = "back";
      
      while (this.peek()?.type === 'PARTICLE' && this.peek()?.value === 'の') {
          const next = this.peek(1);
          if (next && (next.type === 'KW_FRONT' || next.type === 'KW_BACK')) {
              this.consume('PARTICLE');
              break;
          }
          this.consume('PARTICLE');
          target = { type: "MemberExpression", object: target, property: this.parse_primary() };
      }
      
      let hasParticle = false;
      if (this.peek()?.type === 'PARTICLE' && this.peek()?.value.includes('から')) {
        hasParticle = true;
        this.consume('PARTICLE');
      }
      
      if (this.peek()?.type === 'KW_FRONT') {
        this.consume('KW_FRONT');
        if (this.peek()?.type === 'PARTICLE') this.consume('PARTICLE');
        pos = "front";
      } else if (this.peek()?.type === 'KW_BACK') {
        this.consume('KW_BACK');
        if (this.peek()?.type === 'PARTICLE') this.consume('PARTICLE');
        pos = "back";
      }
      
      if (this.peek()?.type === 'KW_POP') {
        this.consume('KW_POP');
        if (this.peek()?.type === 'PARTICLE' && this.peek()?.value === 'の' && this.peek()?.value === 'ㄴ') {
            this.consume(); // Handle '取り出した'
        }
        if (this.peek()?.type === 'KW_VALUE') {
            this.consume('KW_VALUE');
            return { type: "ListPopExpression", target, position: pos };
        }
      }
      this.pos = savedPos;
    }
    
    let expr = this.parse_primary();
    
    while (this.peek()) {
      if (this.peek()?.type === 'KW_INDEX') {
        this.consume('KW_INDEX');
        expr = { type: "IndexExpression", index: expr };
      } else if (this.peek()?.type === 'PARTICLE' && this.peek()?.value === 'の') {
        const next = this.peek(1);
        if (next && (next.type === 'KW_FRONT' || next.type === 'KW_BACK')) {
          break;
        }
        this.consume('PARTICLE');
        let prop = this.parse_primary();
        if (this.peek()?.type === 'KW_INDEX') {
          this.consume('KW_INDEX');
          prop = { type: "IndexExpression", index: prop };
        }
        expr = { type: "MemberExpression", object: expr, property: prop };
      } else if (this.peek()?.type === 'LPAREN') {
        this.consume('LPAREN');
        const args = this.parse_arguments();
        this.consume('RPAREN');
        expr = { type: "CallExpression", callee: expr, arguments: args };
      } else if (this.peek()?.type === 'OP') {
        const op = this.consume().value;
        const right = this.parse_expression();
        expr = { type: "BinaryExpression", operator: op, left: expr, right: right };
      } else if (this.peek()?.type === 'COMPARE' && ['<', '>', '<=', '>=', '==', '!='].includes(this.peek()!.value)) {
        const op = this.consume().value;
        const right = this.parse_expression();
        expr = { type: "BinaryExpression", operator: op, left: expr, right: right };
        } else if (this.peek()?.type === 'LOGIC') {
          const op = this.consume().value;
          const right = this.parse_expression();
          expr = { type: "LogicalExpression", operator: op, left: expr, right: right };
        } else {
          break;
        }
    }
    return expr;
  }

  parse_generic_sov(): ASTNode | null {
    const components: any[] = [];
    const verbs = ['KW_ASSIGN', 'KW_DECLARE', 'KW_ADD', 'KW_SUB', 'KW_APPEND', 'KW_POP', 'KW_PRINT', 'KW_PRINT_INLINE', 'KW_INPUT', 'KW_RETURN', 'KW_EXECUTE', 'KW_THROW', 'KW_FOREACH', 'KW_WHILE', 'KW_IMPORT', 'KW_SWITCH', 'KW_FALLTHROUGH'];
    
    let isStatic = false;

    while (this.peek() && !verbs.includes(this.peek()!.type)) {
      if (this.peek()?.type === 'TYPE') {
        const saved = this.pos;
        const t = this.consume();
        if (this.peek()?.type === 'PARTICLE' && this.peek()?.value === 'の') {
            const next = this.peek(1);
            const isPrimitive = ['文字', '数字', '論理', 'リスト', '辞書'].some(p => t.value.includes(p));
            if (next && next.type === 'FUNCTION' && !isPrimitive) {
               this.pos = saved;
            } else {
               this.consume('PARTICLE');
               components.push({ role: "type_cast", type_val: t.value });
               continue;
            }
          } else {
          this.pos = saved; // backtrack
        }
      }
      
      if (this.peek()?.type === 'KW_FRONT') {
        components.push({ role: "pos_front" });
        this.consume();
        if (this.peek()?.type === 'PARTICLE') this.consume();
        continue;
      }
      
      if (this.peek()?.type === 'KW_BACK') {
        components.push({ role: "pos_back" });
        this.consume();
        if (this.peek()?.type === 'PARTICLE') this.consume();
        continue;
      }
      
      const expr = this.parse_expression();
      let part = null;
      if (this.peek()?.type === 'PARTICLE' || this.peek()?.type === 'KW_FROM' || this.peek()?.type === 'KW_TO') {
        part = this.consume().value;
      }
      components.push({ expr, particle: part });
    }
    
    if (!this.peek()) return null;
    const verb = this.consume();
    
    if (verb.type === 'KW_ASSIGN' || verb.type === 'KW_DECLARE') {
      let target = components.length > 0 ? components[0].expr : null;
      let typeAnnotation = null;
      let init_val = null;
      for (const c of components) {
        if (c.role === "type_cast") typeAnnotation = this.parse_type_reference(c.type_val);
        else if (c.expr && c !== components[0]) init_val = c.expr;
      }
      
      const isConst = verb.value.includes('固定しよう');
      const isDeclarationOnly = verb.type === 'KW_DECLARE';
      
      let getter = null;
      let setter = null;
      
      if (this.peek()?.type === 'COLON') {
        this.consume('COLON');
        if (this.peek()?.type === 'INDENT') {
          this.consume('INDENT');
          while (this.peek() && this.peek()?.type !== 'DEDENT') {
            if (this.peek()?.type === 'KW_GETTER') {
              this.consume('KW_GETTER');
              const blk = this.parse_block();
              getter = blk.body;
            } else if (this.peek()?.type === 'KW_SETTER') {
              this.consume('KW_SETTER');
              this.consume('LPAREN');
              const p = this.consume('VARIABLE').value.slice(1, -1);
              this.consume('RPAREN');
              const blk = this.parse_block();
              setter = { param: { type: "Identifier", name: p }, body: blk.body };
            } else {
              break; // unknown
            }
          }
          if (this.peek()?.type === 'DEDENT') this.consume('DEDENT');
        }
      }
      
      if (target?.type === 'MemberExpression' && target.object.type === 'Identifier' && target.object.name === '私たち' && (verb.type === 'KW_ASSIGN' || verb.type === 'KW_DECLARE')) {
        isStatic = true;
        target = target.property;
      }
      if (!isConst && !isDeclarationOnly && !typeAnnotation && target?.type === 'MemberExpression' && !getter && !setter) {
        let op = "=";
        if (verb.value.includes('足そう')) op = "+=";
        else if (verb.value.includes('引こう')) op = "-=";
        if (op === "=") return { type: "Assignment", target, value: init_val };
        return { type: "CompoundAssignment", operator: op, target, value: init_val };
      }
      
      const acc = verb.value.includes('隠そう') ? "private" : verb.value.includes('受け継ごう') ? "protected" : "public";
      
      return { 
        type: "VariableDeclaration", 
        target, 
        isStatic,
        accessModifier: acc,
        typeAnnotation, 
        value: isDeclarationOnly ? null : init_val, 
        isConst, 
        isDeclarationOnly,
        getter,
        setter
      };
    } else if (verb.type === 'KW_ADD') {
      let target = components[0]?.expr;
      let init_val = components[1]?.expr;
      if (target && (target.type === 'MemberExpression' || target.type === 'Identifier')) {
        return { type: "CompoundAssignment", operator: "+=", target, value: init_val };
      }
    } else if (verb.type === 'KW_SUB') {
      let target = components[0]?.expr;
      let init_val = components[1]?.expr;
      if (target && (target.type === 'MemberExpression' || target.type === 'Identifier')) {
        return { type: "CompoundAssignment", operator: "-=", target, value: init_val };
      }
    } else if (verb.type === 'KW_IMPORT') {
      return { type: "ImportStatement", module: { kind: "user", name: components[0].expr.value }, imports: null };
    } else if (verb.type === 'KW_APPEND') {
      let pos = "back";
      if (components.find(c => c.role === 'pos_front')) pos = "front";
      
      const exprs = components.filter(c => c.expr).map(c => c.expr);
      const target = exprs[0];
      const val = exprs[1];
      
      return { type: "ListPushStatement", target: target, value: val, position: pos };
    } else if (verb.type === 'KW_POP') {
      let pos = "back";
      if (components.find(c => c.role === 'pos_front')) pos = "front";
      
      const exprs = components.filter(c => c.expr).map(c => c.expr);
      const target = exprs[0];
      
      return { type: "ListPopStatement", target: target, position: pos };
    } else if (verb.type === 'KW_PRINT') {
      return { type: "PrintStatement", value: components[0].expr };
    } else if (verb.type === 'KW_PRINT_INLINE') {
      return { type: "PrintInlineStatement", value: components[0].expr };
    } else if (verb.type === 'KW_INPUT') {
      let target = null;
      let typeAnnotation = null;
      for (const c of components) {
        if (c.role === "type_cast") typeAnnotation = this.parse_type_reference(c.type_val);
        else if (c.expr && !target) target = c.expr;
      }
      return { type: "InputStatement", target, typeAnnotation };
    } else if (verb.type === 'KW_RETURN') {
      const exprs = components.filter(c => c.expr).map(c => c.expr);
      return { type: "ReturnStatement", value: exprs.length > 0 ? exprs[0] : null };
    } else if (verb.type === 'KW_EXECUTE') {
      return { type: "ExpressionStatement", expression: components[0].expr };
    } else if (verb.type === 'KW_THROW') {
      return { type: "ThrowStatement", error: components[0].expr };
    } else if (verb.type === 'KW_FALLTHROUGH') {
      return { type: "FallthroughStatement" };
    } else if (verb.type === 'KW_SWITCH') {
      const target_expr = components[0].expr;
      this.consume('COLON');
      if (this.peek()?.type === 'INDENT') this.consume('INDENT');
      
      const cases = [];
      let default_block = null;
      
      while (this.peek() && this.peek()?.type !== 'DEDENT') {
        if (this.peek()?.type === 'KW_DEFAULT') {
          this.consume('KW_DEFAULT');
          const block = this.parse_block();
          default_block = block.body;
        } else {
          const case_vals = [];
          while (true) {
            case_vals.push(this.parse_expression());
            if (this.peek()?.type === 'COMMA') this.consume('COMMA');
            else if (this.peek()?.type === 'KW_CASE') {
              this.consume('KW_CASE');
              break;
            } else {
              throw new Error("SyntaxError: '時'를 찾을 수 없어요. (스위치 구문)");
            }
          }
          const block = this.parse_block();
          cases.push({ values: case_vals, body: block.body });
        }
      }
      if (this.peek()?.type === 'DEDENT') this.consume('DEDENT');
      return { type: "SwitchStatement", discriminant: target_expr, cases, default: default_block };
    } else if (verb.type === 'KW_WHILE') {
      const cond = components[0].expr;
      const block = this.parse_block();
      return { type: "WhileLoop", condition: cond, body: block.body };
    } else if (verb.type === 'KW_FOREACH') {
      const expr = components[0].expr;
      if (expr.type !== 'MemberExpression') {
        throw new KanadeError("SyntaxError: 繰り返し文は '배열(목록)'の '항목'ごとに繰り返そう の形式でなければなりません。", verb.line, verb.col);
      }
      const block = this.parse_block();
      return { type: "ForEachLoop", iterable: expr.object, item: expr.property, body: block.body };
    }
    return null;
  }
}


