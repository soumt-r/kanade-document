import { KanadeRuntimeError, BreakLoop, ReturnValue, type ASTNode } from './types';
import { Lexer } from './lexer';
import { Parser } from './parser';

export class Environment {
  parent: Environment | null;
  vars: Record<string, any>;
  constants: Set<string>;
  
  constructor(parent: Environment | null = null) {
    this.parent = parent;
    this.vars = {};
    this.constants = new Set();
  }

  declare(name: string, value: any, isConst: boolean = false) {
    if (this.vars[name] !== undefined) {
      if (this.constants.has(name)) {
        throw new Error(`ConstantAssignmentError: 定数 '${name}'の値は変更できません。`);
      }
    }
    this.vars[name] = value;
    if (isConst) this.constants.add(name);
  }
  
  assign(name: string, value: any) {
    if (this.constants.has(name)) {
      throw new Error(`ConstantAssignmentError: 定数 '${name}'の値は変更できません。`);
    }
    if (this.vars[name] !== undefined) {
      this.vars[name] = value;
      return;
    }
    if (this.parent) {
      this.parent.assign(name, value);
      return;
    }
    throw new Error(`ReferenceError: まだ準備されていない変数 '${name}'に値に入れようとしました。`);
  }

  get(name: string): any {
    let env: Environment | null = this;
    while (env) {
      if (name in env.vars) {
        return env.vars[name];
      }
      env = env.parent;
    }
    return undefined;
  }
  
  getOuter(name: string): any {
    if (this.parent) {
      return this.parent.get(name);
    }
    return undefined;
  }
  
  assignOuter(name: string, value: any) {
    if (this.parent) {
      this.parent.assign(name, value);
    } else {
      throw new Error(`ReferenceError: 外の範囲で '${name}'が見つかりません。`);
    }
  }
  
  has(name: string): boolean {
    let env: Environment | null = this;
    while (env) {
      if (name in env.vars) return true;
      env = env.parent;
    }
    return false;
  }
}

export class KanadeObject {
  cls_name: string;
  props: Record<string, any>;

  constructor(cls_name: string) {
    this.cls_name = cls_name;
    this.props = {};
  }

  toString() {
    return `[${this.cls_name} オブジェクト]`;
  }
}

export class KanadeInterpreter {
  ast: ASTNode;
  env: Environment;
  classes: Record<string, ASTNode>;
  static_props: Record<string, Record<string, any>>;
  interfaces: Record<string, ASTNode>;
  functions: Record<string, ASTNode>;
  output: string[];
  inline_buffer: string;
  inputCallback?: (promptText: string) => Promise<string>;

  outputCallback?: (msg: string) => void;
  constructor(ast: ASTNode, inputCallback?: (promptText: string) => Promise<string>, outputCallback?: (msg: string) => void) {
    this.outputCallback = outputCallback;
    this.inputCallback = inputCallback;
    this.ast = ast;
    this.env = new Environment();
    this.classes = {};
    this.static_props = {};
    this.interfaces = {};
    this.functions = {};
    this.output = [];
    this.inline_buffer = "";
  }

  async run(): Promise<string> {
    for (const stmt of this.ast.body) {
      if (stmt.type === 'ClassDeclaration') {
        this.classes[stmt.id] = stmt;
        this.static_props[stmt.id] = {};
        for (const s of stmt.body) {
          if (s.type === 'VariableDeclaration' && s.isStatic) {
            this.static_props[stmt.id][s.target.name] = s.value ? await this.evaluate(s.value, this.globalEnv) : null;
          }
        }
      } else if (stmt.type === 'InterfaceDeclaration') {
        this.interfaces[stmt.id] = stmt;
      } else if (stmt.type === 'FunctionDeclaration') {
        this.functions[stmt.id] = stmt;
      }
    }

    // Verify Interfaces
    for (const clsName in this.classes) {
      const cls = this.classes[clsName];
      for (let ifaceName of (cls.interfaces || [])) {
        if (typeof ifaceName === 'object' && ifaceName.name) ifaceName = ifaceName.name;
        const iface = this.interfaces[ifaceName];
        if (!iface) throw new KanadeRuntimeError(`InterfaceImplementationError: インターフェース '${ifaceName}'が見つかりません。`, cls.line);
        for (const req of iface.body) {
          if (req.type === 'InterfaceMethod') {
            const hasMethod = cls.body.some((s: any) => s.type === 'FunctionDeclaration' && s.id === req.id);
            if (!hasMethod) throw new KanadeRuntimeError(`InterfaceImplementationError: クラス '${cls.id}'は約束された '${req.id}' 機能を必ず実装しなければなりません。`, cls.line);
          }
        }
      }
    }

    for (const stmt of this.ast.body) {
      if (!['ClassDeclaration', 'InterfaceDeclaration', 'FunctionDeclaration'].includes(stmt.type)) {
        await this.execute(stmt, this.env);
      }
    }
    
    if (this.inline_buffer !== "") {
      this.output.push(this.inline_buffer);
    }
    return this.output.join("\n");
  }

  format_value(val: any): string {
    if (val === null || val === undefined) return "空っぽ";
    if (typeof val === 'boolean') return val ? "真" : "偽";
    if (Array.isArray(val)) return "[" + val.map(v => this.format_value(v)).join(", ") + "]";
    if (typeof val === 'object' && !(val instanceof KanadeObject)) {
      const entries = Object.entries(val).map(([k, v]) => `"${k}": ${this.format_value(v)}`);
      return "{" + entries.join(", ") + "}";
    }
    return String(val);
  }

  async execute(stmt: ASTNode, env: Environment): Promise<any> {
    try {
      return await this._do_execute(stmt, env);
    } catch (e: any) {
      if (e.name === 'ReturnValue' || e.name === 'KanadeRuntimeError' || e.name === 'BreakLoop') {
        throw e;
      }
      const line = stmt.line || '?';
      throw new KanadeRuntimeError(`[${line}行目]  ${e.message || String(e)}`, line as number);
    }
  }

  
  check_type(val: any, ann: any) {
    if (!ann || ann.type !== 'TypeReference') return;
    if (val === null || val === undefined) return;
    const tname = ann.name;
    if (tname === '何でも') return;
    if ((tname === '文字' || tname === '文字列') && typeof val !== 'string') throw new Error(`TypeError: 値が文字タイプではありません。`);
    if (tname === '数字' && typeof val !== 'number') throw new Error(`TypeError: 値が数字タイプではありません。`);
    if (tname === '真偽' && typeof val !== 'boolean') throw new Error(`TypeError: 値が 真偽 タイプではありません。`);
    if (tname === 'リスト' || tname === 'リスト') {
      if (!Array.isArray(val)) throw new Error(`TypeError: 値がリストタイプではありません。`);
      if (ann.typeArgs && ann.typeArgs.length > 0) {
        for (const item of val) this.check_type(item, ann.typeArgs[0]);
      }
      return;
    }
    if (tname === '辞書') {
      if (typeof val !== 'object' || Array.isArray(val) || val instanceof KanadeObject) throw new Error(`TypeError: 値が辞書タイプではありません。`);
      if (ann.typeArgs && ann.typeArgs.length === 2) {
        for (const v of Object.values(val)) this.check_type(v, ann.typeArgs[1]);
      }
      return;
    }
    if (val instanceof KanadeObject) {
       let clsName: string | null = val.cls_name;
       let matched = false;
       while (clsName) {
         if (clsName === tname) { matched = true; break; }
         const c = this.classes[clsName];
         clsName = c && c.baseClass ? (c.baseClass.name || c.baseClass) : null;
       }
       if (!matched) {
         let currentCls: string | null = val.cls_name;
         while (currentCls) {
           const c = this.classes[currentCls];
           if (c && c.interfaces) {
             for (const iface of c.interfaces) {
               if ((iface.name || iface) === tname) { matched = true; break; }
             }
           }
           if (matched) break;
           currentCls = c && c.baseClass ? (c.baseClass.name || c.baseClass) : null;
         }
       }
       if (!matched) throw new Error(`TypeError: 値が ${tname} タイプではありません。`);
    }
  }

  async _do_execute(stmt: ASTNode, env: Environment): Promise<any> {
    const t = stmt.type;

    if (t === 'VariableDeclaration') {
          const val = stmt.value ? await this.evaluate(stmt.value, env) : null;
          this.check_type(val, stmt.typeAnnotation);
          if (stmt.isStatic && env.has('私たち')) {
             const clsObj = env.get('私たち');
             if (clsObj && clsObj.type === 'TypeReference' && this.static_props[clsObj.name]) {
                 this.static_props[clsObj.name][stmt.target.name] = val;
                 return;
             }
          }
          if (stmt.target.type === 'Identifier') {
            env.declare(stmt.target.name, val, stmt.isConst || false);
          }
    } else if (t === 'Assignment') {
      const val = stmt.value ? await this.evaluate(stmt.value, env) : null;
      const tgt = stmt.target;
      if (tgt.type === 'Identifier') {
        env.assign(tgt.name, val);
      } else if (tgt.type === 'MemberExpression') {
        if (tgt.object.type === 'TypeReference') {
          const cname = tgt.object.name;
          this.static_props[cname][tgt.property.name] = compute(this.static_props[cname][tgt.property.name], val);
  
          return;
        }
        if (tgt.object.type === 'TypeReference') {
            const cname = tgt.object.name;
            this.static_props[cname][tgt.property.name] = val;
            return;
          }
          if (tgt.object.type === 'OuterReference') {
            env.assignOuter(tgt.property.name, val);
            return;
          }
        const obj = await this.evaluate(tgt.object, env);
        if (typeof obj === 'string') {
          throw new Error("ImmutableAssignmentError: 文字列の一部を直接変更できません。");
        }
        if (obj instanceof KanadeObject) {
          const propName = tgt.property.name;
          const expr = null; const stmt = null;

        const find_property_decl = (cname: string): any => {
          const cast = this.classes[cname];
          if (!cast) return null;
          for (const s of cast.body) {
            if (s.type === 'VariableDeclaration' && s.target.name === propName) return s;
          }
          if (cast.baseClass) return find_property_decl(cast.baseClass.name || cast.baseClass);
          return null;
        };
        const decl = find_property_decl(obj.cls_name);
        if (decl && decl.accessModifier !== 'public' && !(expr && expr.is_fake) && !(stmt && stmt.is_fake)) {
           if (decl.accessModifier === 'private') {
             if (env.get('this') !== obj) throw new Error(`AccessViolationError: '${propName}' 属性は内部専用(private)なので外部から呼べません。`);
           } else if (decl.accessModifier === 'protected') {
             if (!env.has('this')) throw new Error(`AccessViolationError: '${propName}' 属性は継承されたクラス専用(protected)なので外部から呼べません。`);
           }
        }

          const find_setter = (cname: string): any => {
            const cast = this.classes[cname];
            if (!cast) return null;
            for (const s of cast.body) {
              if (s.type === 'VariableDeclaration' && s.target.name === propName && s.setter) return s.setter;
            }
            if (cast.baseClass) return find_setter(cast.baseClass.name || cast.baseClass);
            return null;
          };
          const setter = find_setter(obj.cls_name);
          if (setter) {
            const setter_env = new Environment(env);
            setter_env.declare('this', obj, false);
            setter_env.declare(setter.param.name, val, false);
            try {
              for (const s of setter.body) await this.execute(s, setter_env);
            } catch (e: any) {
              if (e.name === 'ReturnValue') return e.value;
              throw e;
            }
            return;
          }
          obj.props[propName] = val;
        } else if (Array.isArray(obj)) {
          let idx = -1;
          if (tgt.property.type === 'IndexLiteral') idx = tgt.property.value - 1;
          else if (tgt.property.type === 'IndexExpression') idx = await this.evaluate(tgt.property.index, env) - 1;
          else if (tgt.property.type === 'Literal') idx = await this.evaluate(tgt.property, env);
          
          if (idx !== -1) {
            if (t === 'Assignment') obj[idx] = val;
            else if (t === 'MathAdd') obj[idx] = (obj[idx] || 0) + val;
            else if (t === 'MathSubtract') obj[idx] = (obj[idx] || 0) - val;
          }
        } else if (obj !== null && typeof obj === 'object') {
          if (tgt.property.type === 'Literal') obj[await this.evaluate(tgt.property, env)] = val;
          else if (tgt.property.type === 'Identifier') obj[tgt.property.name] = val;
        }
      }
    } else if (t === 'ExpressionStatement') {
      await this.evaluate(stmt.expression, env);
    } else if (t === 'PrintStatement') {
      const val = this.format_value(await this.evaluate(stmt.value, env));
      const line = this.inline_buffer + val;
      this.output.push(line);
      if (this.outputCallback) this.outputCallback(line + "\n");
      this.inline_buffer = "";
    } else if (t === 'PrintInlineStatement') {
      const val = this.format_value(await this.evaluate(stmt.value, env));
      this.inline_buffer += val;
      if (this.outputCallback) this.outputCallback(val);
    } else if (t === 'InputStatement') {
        const target = stmt.target.name;
        const typeAnn = stmt.typeAnnotation ? stmt.typeAnnotation.name : '文字';
        let user_input = "";
        
        if (!['文字', '数字', '真偽'].includes(typeAnn)) {
            throw new Error(`UnsupportedInputTypeError: '${typeAnn}' タイプは入力で受け取れません。`);
        }
        
        if (this.inputCallback) {
          user_input = await this.inputCallback("") || "";
        } else {
          user_input = prompt(`入力 (${typeAnn}): `) || "";
        }
        
        let final_val: any = user_input;
        if (typeAnn === '数字') {
            final_val = Number(user_input);
            if (isNaN(final_val)) throw new Error(`InputConversionError: '${user_input}' は数字に変換できません。`);
        } else if (typeAnn === '真偽') {
            if (user_input === '真') final_val = true;
            else if (user_input === '偽') final_val = false;
            else throw new Error(`InputConversionError: '${user_input}' は真偽に変換できません。`);
        }

      this.inline_buffer = "";
      
      let val: any = user_input;
      if (typeAnn === '数字') {
         val = Number(user_input);
         if (isNaN(val)) val = 0;
      } else if (typeAnn === '真偽') {
         val = (user_input === '真' || user_input === 'true');
      }
      try {
        env.assign(target, val);
      } catch (e) {
        env.declare(target, val, false);
      }
    } else if (t === 'CompoundAssignment') {
      const tgt = stmt.target;
      const val = await this.evaluate(stmt.value, env);
      const op = stmt.operator;
      
      const compute = (a: any, b: any) => {
        if (a === undefined || a === null) a = 0;
        if (op === '+=') {
          if (typeof a === 'string' || typeof b === 'string') {
            if (typeof a !== 'string' || typeof b !== 'string') throw new Error("TypeError: 文字列と他のタイプは足せません。");
          }
          return a + b;
        } else if (op === '-=') {
          return a - b;
        } else if (op === '*=') {
          return a * b;
        } else if (op === '/=') {
          if (b === 0) throw new Error("DivideByZeroError: 0で割ることはできません。");
          return a / b;
        }
        return a; // fallback
      };
      
      if (tgt.type === 'Identifier') {
        env.assign(tgt.name, compute(env.get(tgt.name), val));
      } else if (tgt.type === 'MemberExpression') {
        if (tgt.object.type === 'TypeReference') {
          const cname = tgt.object.name;
          this.static_props[cname][tgt.property.name] = compute(this.static_props[cname][tgt.property.name], val);
  
          return;
        }
        if (tgt.object.type === 'OuterReference') {
          env.assignOuter(tgt.property.name, compute(env.getOuter(tgt.property.name), val));
          return;
        }
        const obj = await this.evaluate(tgt.object, env);
        if (obj && typeof obj === 'object' && obj.type === 'TypeReference') {
          const cname = obj.name;
          this.static_props[cname][tgt.property.name] = compute(this.static_props[cname][tgt.property.name], val);
  
          return;
        }
        if (typeof obj === 'string') throw new Error("ImmutableAssignmentError: 文字列の一部を直接変更できません。");
        if (obj instanceof KanadeObject) {
          const propName = tgt.property.name;
          const expr = null; const stmt = null;

        const find_property_decl = (cname: string): any => {
          const cast = this.classes[cname];
          if (!cast) return null;
          for (const s of cast.body) {
            if (s.type === 'VariableDeclaration' && s.target.name === propName) return s;
          }
          if (cast.baseClass) return find_property_decl(cast.baseClass.name || cast.baseClass);
          return null;
        };
        const decl = find_property_decl(obj.cls_name);
        if (decl && decl.accessModifier !== 'public' && !(expr && expr.is_fake) && !(stmt && stmt.is_fake)) {
           if (decl.accessModifier === 'private') {
             if (env.get('this') !== obj) throw new Error(`AccessViolationError: '${propName}' 属性は内部専用(private)なので外部から呼べません。`);
           } else if (decl.accessModifier === 'protected') {
             if (!env.has('this')) throw new Error(`AccessViolationError: '${propName}' 属性は継承されたクラス専用(protected)なので外部から呼べません。`);
           }
        }

          const find_setter = (cname: string): any => {
            const cast = this.classes[cname];
            if (!cast) return null;
            for (const s of cast.body) {
              if (s.type === 'VariableDeclaration' && s.target.name === propName && s.setter) return s.setter;
            }
            if (cast.baseClass) return find_setter(cast.baseClass.name || cast.baseClass);
            return null;
          };
          const setter = find_setter(obj.cls_name);
          const find_getter = (cname: string): ASTNode[] | null => {
            const cast = this.classes[cname];
            if (!cast) return null;
            for (const s of cast.body) {
              if (s.type === 'VariableDeclaration' && s.target.name === propName && s.getter) return s.getter;
            }
            if (cast.baseClass) return find_getter(cast.baseClass.name || cast.baseClass);
            return null;
          };
          const getter = find_getter(obj.cls_name);
          let current_val = obj.props[propName];
          if (getter) {
            const getter_env = new Environment(env);
            getter_env.declare('this', obj, false);
            try {
              for (const s of getter) await this.execute(s, getter_env);
            } catch (e: any) {
              if (e.name === 'ReturnValue') current_val = e.value;
              else throw e;
            }
          }
          const new_val = compute(current_val, val);
          if (setter) {
            const setter_env = new Environment(env);
            setter_env.declare('this', obj, false);
            setter_env.declare(setter.param.name, new_val, false);
            try {
              for (const s of setter.body) await this.execute(s, setter_env);
            } catch (e: any) {
              if (e.name === 'ReturnValue') return;
              throw e;
            }
            return;
          }
          obj.props[propName] = new_val;
        } else if (Array.isArray(obj)) {
          let idx = -1;
          if (tgt.property.type === 'IndexLiteral') idx = tgt.property.value - 1;
          else if (tgt.property.type === 'IndexExpression') idx = await this.evaluate(tgt.property.index, env) - 1;
          else if (tgt.property.type === 'Literal') idx = await this.evaluate(tgt.property, env);
          
          if (idx !== -1) obj[idx] = compute(obj[idx], val);
        } else if (obj !== null && typeof obj === 'object') {
          if (tgt.property.type === 'Literal') obj[await this.evaluate(tgt.property, env)] = compute(obj[await this.evaluate(tgt.property, env)], val);
          else if (tgt.property.type === 'Identifier') obj[tgt.property.name] = compute(obj[tgt.property.name], val);
        }
      }
    } else if (t === 'ListAppend' || t === 'ListPushStatement') {
      const tgt = stmt.target;
      const val = stmt.value ? await this.evaluate(stmt.value, env) : null;
      let obj;
      if (tgt.type === 'Identifier') {
        obj = env.get(tgt.name);
      } else if (tgt.type === 'MemberExpression') {
        if (tgt.object.type === 'OuterReference') {
          obj = env.getOuter(tgt.property.name);
        } else {
          const parent = await this.evaluate(tgt.object, env);
          if (parent instanceof KanadeObject) {
            obj = parent.props[tgt.property.name];
          } else if (parent !== null && typeof parent === 'object') {
            const key = tgt.property.type === 'Literal' ? await this.evaluate(tgt.property, env) : tgt.property.name;
            obj = parent[key];
          }
        }
      }
      
      if (!Array.isArray(obj)) { console.log("DEBUG TGT:", tgt, "OBJ:", obj); throw new Error("TypeError: リストではありません。"); }
      if (stmt.position === 'front') obj.unshift(val);
      else obj.push(val);
    } else if (t === 'ListPopStatement') {
      const tgt = stmt.target;
      let obj;
      if (tgt.type === 'Identifier') obj = env.get(tgt.name);
      else if (tgt.type === 'MemberExpression') {
         if (tgt.object.type === 'OuterReference') obj = env.getOuter(tgt.property.name);
         else {
           const parent = await this.evaluate(tgt.object, env);
           if (parent instanceof KanadeObject) obj = parent.props[tgt.property.name];
           else if (parent !== null && typeof parent === 'object') {
             const key = tgt.property.type === 'Literal' ? await this.evaluate(tgt.property, env) : tgt.property.name;
             obj = parent[key];
           }
         }
      }
      if (!Array.isArray(obj)) throw new Error("TypeError: リストではありません。");
      if (obj.length === 0) throw new Error("IndexOutOfBoundsError: 空のリストから値を取り出せません。");
      if (stmt.position === 'front') obj.shift();
      else obj.pop();
    } else if (t === 'ImportStatement') {
      // For web playground, we just ignore imports or throw unsupported
      throw new Error("Webプレイグラウンドでは外部ファイル(モジュール)のインポートをまだサポートしていません。");
    } else if (t === 'IfStatement') {
      const cond = await this.evaluate(stmt.condition, env);
      let executed = false;
      if (cond) {
        for (const bs of stmt.consequent) await this.execute(bs, env);
        executed = true;
      } else if (stmt.elifs && stmt.elifs.length > 0) {
        for (const elif of stmt.elifs) {
          if (await this.evaluate(elif.condition, env)) {
            for (const bs of elif.consequent) await this.execute(bs, env);
            executed = true;
            break;
          }
        }
      }
      
      if (!executed && stmt.alternate) {
        for (const bs of stmt.alternate) await this.execute(bs, env);
      }
    } else if (t === 'TryStatement') {
      try {
        for (const s of stmt.block) await this.execute(s, env);
      } catch (e: any) {
        if (e.name === 'ReturnValue') throw e;
        let msg = e.message || String(e);
        msg = msg.replace(/^\[\d+行目\]\s*/, '');
        
        let handled = false;
        if (stmt.handlers && stmt.handlers.length > 0) {
          for (const handler of stmt.handlers) {
            // Check if catchType matches the error's name, or if there's no catchType
            if (!handler.catchType || handler.catchType.name === e.name || e.name === 'KanadeRuntimeError') {
              const catch_env = new Environment(env);
              const err_val = e.hajaObj || msg;
              catch_env.declare(handler.param.name || handler.param, err_val, false);
              for (const s of handler.body) await this.execute(s, catch_env);
              handled = true;
              break;
            }
          }
        }
        if (!handled) throw e;
      } finally {
        if (stmt.finalizer) {
          for (const s of stmt.finalizer) await this.execute(s, env);
        }
      }
    } else if (t === 'ForRangeStatement') {
      const start = parseInt(await this.evaluate(stmt.start, env), 10);
      const end = parseInt(await this.evaluate(stmt.end, env), 10);
      for (let i = start; i <= end; i++) {
        const loop_env = new Environment(env);
        loop_env.declare(stmt.iterator.name || stmt.iterator, i, false);
        try {
          for (const s of stmt.body) await this.execute(s, loop_env);
        } catch (e: any) {
          if (e.name === 'BreakLoop') break;
          throw e;
        }
      }
    } else if (t === 'SwitchStatement') {
      const disc = await this.evaluate(stmt.discriminant, env);
      let matched = false;
      let fallthrough = false;
      
      for (const case_ast of stmt.cases) {
        if (!matched && !fallthrough) {
          for (const val_ast of case_ast.values) {
            if (await this.evaluate(val_ast, env) === disc) {
              matched = true;
              break;
            }
          }
        }
        
        if (matched || fallthrough) {
          fallthrough = false;
          for (const s of case_ast.body) {
            if (s.type === 'FallthroughStatement') {
              fallthrough = true;
              break;
            }
            const ret = await this.execute(s, env);
            if (ret !== undefined) return ret;
          }
          if (!fallthrough) break;
        }
      }
      
      if ((!matched || fallthrough) && stmt.default) {
        for (const s of stmt.default) {
          const ret = await this.execute(s, env);
          if (ret !== undefined) return ret;
        }
      }
    } else if (t === 'WhileLoop') {
      while (await this.evaluate(stmt.condition, env)) {
        const loop_env = new Environment(env);
        try {
          for (const s of stmt.body) await this.execute(s, loop_env);
        } catch (e: any) {
          if (e.name === 'BreakLoop') break;
          throw e;
        }
      }
    } else if (t === 'ForEachLoop') {
        const iterable = await this.evaluate(stmt.iterable, env);
        if (!Array.isArray(iterable)) throw new Error("TypeError: 反復できるリストや辞書ではありません。");
      for (const item of iterable) {
        const loop_env = new Environment(env);
        loop_env.declare(stmt.item.name, item, false);
        try {
          for (const s of stmt.body) await this.execute(s, loop_env);
        } catch (e: any) {
          if (e.name === 'BreakLoop') break;
          throw e;
        }
      }
    } else if (t === 'BreakStatement') {
      throw new BreakLoop();
    } else if (t === 'ThrowStatement') {
      const err_obj = await this.evaluate(stmt.error, env);
      const msg = err_obj instanceof KanadeObject ? (err_obj.props['メッセージ'] || '不明なエラー') : String(err_obj);
      throw new KanadeRuntimeError(msg, (stmt as any).line || 0, err_obj instanceof KanadeObject ? err_obj : undefined);
    } else if (t === 'ReturnStatement') {
      const val = stmt.value ? await this.evaluate(stmt.value, env) : null;
      throw new ReturnValue(val);
    }
  }

  async evaluate(expr: ASTNode, env: Environment): Promise<any> {
    const t = expr.type;
    
    if (t === 'Literal') return expr.value; else if (t === 'Identifier') {
      if (expr.name === '私' && env.has('this')) return env.get('this');
      if (expr.name === '親' && env.has('this')) return { type: "SuperReference", object: env.get('this') };
      const val = env.get(expr.name);
      if (val === undefined && this.classes[expr.name]) {
         return { type: "TypeReference", name: expr.name, typeArgs: [] };
      }
      return val;
    } else if (t === 'ListLiteral') {
      const _els = [];
      for (const el of (expr.elements || [])) {
        _els.push(await this.evaluate(el, env));
      }
      return _els;
    } else if (t === 'DictLiteral') {
      const obj: Record<string, any> = {};
      for (const prop of expr.elements) {
        const key = await this.evaluate(prop.key, env);
        const val = await this.evaluate(prop.value, env);
        obj[key] = val;
      }
      return obj;
    } else if (t === 'TypeReference') {
        return { type: "TypeReference", name: expr.name, typeArgs: expr.typeArgs || [] };
      } else if (t === 'Identifier') {
      if (expr.name === '私' && env.has('this')) return env.get('this');
      if (expr.name === '親' && env.has('this')) return { type: "SuperReference", object: env.get('this') };
      return env.get(expr.name);
    } else if (t === 'OuterReference') {
      return { type: "OuterReference" };
    } else if (t === 'ListPopExpression') {
      const tgt = expr.target;
      let obj;
      if (tgt.type === 'Identifier') obj = env.get(tgt.name);
      else if (tgt.type === 'MemberExpression') {
         if (tgt.object.type === 'OuterReference') obj = env.getOuter(tgt.property.name);
         else {
           const parent = await this.evaluate(tgt.object, env);
           if (parent instanceof KanadeObject) obj = parent.props[tgt.property.name];
           else if (parent !== null && typeof parent === 'object') {
             const key = tgt.property.type === 'Literal' ? await this.evaluate(tgt.property, env) : tgt.property.name;
             obj = parent[key];
           }
         }
      }
      if (!Array.isArray(obj)) throw new Error("TypeError: リストではありません。");
      if (obj.length === 0) throw new Error("IndexOutOfBoundsError: 空のリストから値を取り出せません。");
      if (expr.position === 'front') return obj.shift();
      return obj.pop();
    } else if (t === 'Identifier') {
      if (expr.name === '私' && env.has('this')) return env.get('this');
      if (expr.name === '親' && env.has('this')) return { type: "SuperReference", object: env.get('this') };
      return env.get(expr.name);
    } else if (t === 'OuterReference') {
      return { type: "OuterReference" };
    } else if (t === 'TypeLiteral') {
      return expr.name;
    } else if (t === 'FunctionReference') {
      return expr.expression ? await this.evaluate(expr.expression, env) : expr.name;
    } else if (t === 'SuperReference') {
      if (!env.has('this')) throw new Error("SuperReferenceError: 親が見つからない場所で親を呼びました。");
      return { type: "SuperReference", object: env.get('this') };
    } else if (t === 'TemplateLiteral') {
      let res = "";
      for (let i = 0; i < expr.strings.length; i++) {
        res += expr.strings[i];
        if (i < expr.expressions.length) {
          res += this.format_value(await this.evaluate(expr.expressions[i], env));
        }
      }
      return res;
    } else if (t === 'NewExpression') {
      const cls = expr.class || expr.callee?.name;
      const cast_ast = this.classes[cls];
      if (cast_ast && cast_ast.isAbstract) throw new Error(`InstantiationError: 下設計 クラス '${cls}'は直接作成できません。`);
      
      const obj = new KanadeObject(cls);
      
      const init_props = async (cname: string) => {
        const cast = this.classes[cname];
        if (!cast) return;
        if (cast.baseClass) await init_props(cast.baseClass.name || cast.baseClass);
        for (const s of cast.body) {
          if (s.type === 'VariableDeclaration' || s.type === 'Assignment') {
            obj.props[s.target.name] = s.value ? await this.evaluate(s.value, env) : null;
          }
        }
      };
      await init_props(cls);
      
      if (cls === 'エラー' && expr.arguments.length > 0) {
        obj.props['メッセージ'] = await this.evaluate(expr.arguments[0], env);
      }
      
      const fake_callee = { type: "BoundMethod", object: obj, func_name: "最初に作られる時" };
      const ctor_env = new Environment(env); // Wait, NewExpression doesn't use this directly.
      // But CallExpression handles 'BoundMethod' and sets up func_env.
      await this.evaluate({ type: "CallExpression", callee: fake_callee, arguments: expr.arguments, is_fake: true }, env);
      return obj;
    } else if (t === 'MemberExpression') {
      if (expr.object.type === 'TypeReference') {
        const cname = expr.object.name;
        if (expr.property.type === 'FunctionReference') {
          return { type: "BoundMethod", object: { type: "StaticClass", name: cname }, func_name: expr.property.expression ? await this.evaluate(expr.property.expression, env) : expr.property.name };
        }
        const ret = this.static_props[cname]?.[expr.property.name];
  
  return ret;
      }
      if (expr.object.type === 'OuterReference') {
        return env.getOuter(expr.property.name);
      }
      const obj = await this.evaluate(expr.object, env);
      
      if (obj && typeof obj === 'object' && obj.type === 'TypeReference') {
        const cname = obj.name;
        if (expr.property.type === 'FunctionReference') {
          return { type: "BoundMethod", object: { type: "StaticClass", name: cname }, func_name: expr.property.expression ? await this.evaluate(expr.property.expression, env) : expr.property.name };
        }
        const ret = this.static_props[cname]?.[expr.property.name];
  
  return ret;
      }
      if (obj && typeof obj === 'object' && obj.type === 'SuperReference') {
        return { type: "BoundMethod", object: obj.object, func_name: expr.property.name, is_super: true };
      }
      if (obj instanceof KanadeObject) {
        if (expr.property.type === 'FunctionReference') {
          return { type: "BoundMethod", object: obj, func_name: expr.property.expression ? await this.evaluate(expr.property.expression, env) : expr.property.name };
        }
        const propName = expr.property.name;
        const stmt = null;

        const find_property_decl = (cname: string): any => {
          const cast = this.classes[cname];
          if (!cast) return null;
          for (const s of cast.body) {
            if (s.type === 'VariableDeclaration' && s.target.name === propName) return s;
          }
          if (cast.baseClass) return find_property_decl(cast.baseClass.name || cast.baseClass);
          return null;
        };
        const decl = find_property_decl(obj.cls_name);
        if (decl && decl.accessModifier !== 'public' && !(expr && expr.is_fake) && !(stmt && stmt.is_fake)) {
           if (decl.accessModifier === 'private') {
             if (env.get('this') !== obj) throw new Error(`AccessViolationError: '${propName}' 属性は内部専用(private)なので外部から呼べません。`);
           } else if (decl.accessModifier === 'protected') {
             if (!env.has('this')) throw new Error(`AccessViolationError: '${propName}' 属性は継承されたクラス専用(protected)なので外部から呼べません。`);
           }
        }

        // Check getter
        const find_getter = (cname: string): ASTNode[] | null => {
          const cast = this.classes[cname];
          if (!cast) return null;
          for (const s of cast.body) {
            if (s.type === 'VariableDeclaration' && s.target.name === propName && s.getter) return s.getter;
          }
          if (cast.baseClass) return find_getter(cast.baseClass.name || cast.baseClass);
          return null;
        };
        const getter = find_getter(obj.cls_name);
        if (getter) {
          const getter_env = new Environment(env);
          getter_env.declare('this', obj, false);
          try {
            for (const s of getter) await this.execute(s, getter_env);
          } catch (e: any) {
            if (e.name === 'ReturnValue') return e.value;
            throw e;
          }
          return null;
        }
        return obj.props[propName];
      }
      if (Array.isArray(obj)) {
        if (expr.property.type === 'LengthLiteral' || (expr.property.type === 'Identifier' && expr.property.name === '長さ')) return obj.length;
        if (expr.property.type === 'FunctionReference' && expr.property.name === '空にする') return { type: "NativeMethod", object: obj, func_name: '空にする' };
        
        let idx = -1;
        if (expr.property.type === 'IndexLiteral') idx = expr.property.value - 1;
        else if (expr.property.type === 'IndexExpression') idx = await this.evaluate(expr.property.index, env) - 1;
        else if (expr.property.type === 'Literal') idx = await this.evaluate(expr.property, env);
        
        if (idx !== -1) {
          if (typeof idx === 'number' && (idx < 0 || idx >= obj.length)) throw new Error("IndexOutOfBoundsError: リストの長さを超えた位置(インデックス)です。");
          return obj[idx];
        }
      }
      if (typeof obj === 'string') {
        if (expr.property.type === 'LengthLiteral' || (expr.property.type === 'Identifier' && expr.property.name === '長さ')) return Array.from(obj).length;
        if (expr.property.type === 'FunctionReference') return { type: "NativeMethod", object: obj, func_name: expr.property.expression ? await this.evaluate(expr.property.expression, env) : expr.property.name };
        
        let idx = -1;
        if (expr.property.type === 'IndexLiteral') idx = expr.property.value - 1;
        else if (expr.property.type === 'IndexExpression') idx = await this.evaluate(expr.property.index, env) - 1;
        else if (expr.property.type === 'Literal') idx = await this.evaluate(expr.property, env);
        
        if (idx !== -1) {
          const arr = Array.from(obj);
          if (typeof idx === 'number' && (idx < 0 || idx >= arr.length)) throw new Error("IndexOutOfBoundsError: 文字列の長さを超えた位置(インデックス)です。");
          return arr[idx];
        }
      }
      if (obj !== null && typeof obj === 'object') {
        if (expr.property.type === 'Literal') {
          const key = await this.evaluate(expr.property, env);
          if (!(key in obj)) throw new Error(`KeyError: 辞書で '${key}' 名前が見つかりません。`);
          return obj[key];
        }
        if (expr.property.type === 'Identifier') {
          const key = expr.property.name;
          if (!(key in obj)) throw new Error(`KeyError: 辞書で '${key}' 名前が見つかりません。`);
          return obj[key];
        }
      }
    } else if (t === 'CallExpression') {
      const callee = expr.is_fake ? expr.callee : await this.evaluate(expr.callee, env);
      
      if (callee && typeof callee === 'object' && callee.type === 'NativeMethod') {
         const obj = callee.object;
         const fname = callee.func_name;
         const args = [];
         for (const a of expr.arguments) args.push(await this.evaluate(a, env));
         
         if (Array.isArray(obj)) {
           if (fname === '空にする') { obj.length = 0; return null; }
         } else if (typeof obj === 'string') {
           if ((fname === '切り取る' || fname === '切り取り')) {
             const arr = Array.from(obj);
             const start = (args[0] || 1) - 1;
             const end = args[1] || arr.length;
             return arr.slice(start, end).join('');
           }
           if ((fname === '変える' || fname === '入れ替え')) return obj.split(args[0]).join(args[1]);
           if ((fname === '含まれるか確認' || fname === '含むか確認')) return obj.includes(args[0]);
           if ((fname === '分ける' || fname === '分割')) {
             if (!obj.includes(args[0])) return [obj];
             return obj.split(args[0]);
           }
         }
         throw new Error(`MethodNotFoundError: サポートされていない組み込み機能 '${fname}'です。`);
      }
      
      if (callee && typeof callee === 'object' && callee.type === 'BoundMethod') {
        const obj = callee.object;
        const fname = callee.func_name;
        const is_super = callee.is_super || false;

        if (obj && obj.type === 'StaticClass') {
          const cname = obj.name;
          const cast = this.classes[cname];
          let func_decl = null;
          for (const s of cast.body) {
             if (s.type === 'FunctionDeclaration' && s.id === fname && s.isStatic) {
                 func_decl = s; break;
             }
          }
          if (!func_decl) throw new Error(`MethodNotFoundError: ${cname} クラスには静的メソッド ${fname}がありません。`);
          
          const func_env = new Environment(env);
          func_env.declare('私たち', { type: "TypeReference", name: cname, typeArgs: [] }, false);
          
          const params = func_decl.params || [];
          if (expr.arguments.length > params.length) throw new Error("ArgumentError: 関数に渡された引数の数が多すぎます。");
          for (let i = 0; i < params.length; i++) {
             if (i < expr.arguments.length) {
                func_env.declare(params[i].name, await this.evaluate(expr.arguments[i], env), false);
             } else if (params[i].default) {
                func_env.declare(params[i].name, await this.evaluate(params[i].default, env), false);
             } else {
                throw new Error("MissingArgumentError: 関数の実行に必要な引数が欠落しています。");
             }
          }
          try {
             for (const s of func_decl.body || []) await this.execute(s, func_env);
          } catch (e: any) {
             if (e.name === 'ReturnValue') return e.value;
             throw e;
          }
          return null;
        }

        
        const find_and_run = async (cname: string, skip_cur: boolean): Promise<[boolean, any]> => {
          const cast = this.classes[cname];
          if (!cast) return [false, null];
          
          if (!skip_cur) {
            for (const s of cast.body) {
              if ((s.type === 'FunctionDeclaration' && s.id === fname) || (s.type === 'ConstructorDeclaration' && fname === '最初に作られる時')) {
                if (s.accessModifier === 'private' && !expr.is_fake) {
                  if (env.get('this') !== obj) throw new Error(`AccessViolationError: '${fname}' 機能は内部専用(private)なので外部から呼べません。`);
                }
                if (s.accessModifier === 'protected' && !expr.is_fake) {
                  if (!env.has('this')) throw new Error(`AccessViolationError: '${fname}' 機能は継承されたクラス専用(protected)なので外部から呼べません。`);
                }
                
                const local_env = new Environment(env);
                local_env.declare('this', obj, false);
                local_env.declare('私たち', { type: "TypeReference", name: obj.cls_name, typeArgs: [] }, false);
                const params = s.params || [];
                if (expr.arguments.length > params.length) throw new Error("ArgumentError: 関数に渡された引数の数が多すぎます。");
                for (let i = 0; i < params.length; i++) {
                  if (i < expr.arguments.length) {
                    local_env.declare(params[i].name, await this.evaluate(expr.arguments[i], env), false);
                  } else if (params[i].default) {
                    local_env.declare(params[i].name, await this.evaluate(params[i].default, env), false);
                  } else {
                    throw new Error("MissingArgumentError: 関数の実行に必要な引数が欠落しています。");
                  }
                }
                try {
                  for (const bs of s.body) await this.execute(bs, local_env);
                } catch (e: any) {
                  if (e.name === 'ReturnValue') return [true, e.value];
                  throw e;
                }
                return [true, null];
              }
            }
          }
          
          if (cast.baseClass) {
            const [found, val] = await find_and_run(cast.baseClass.name || cast.baseClass, false);
            if (found) return [true, val];
          }
          return [false, null];
        };
        
        const [found, val] = await find_and_run(obj.cls_name, is_super);
        if (!found && !expr.is_fake) throw new Error(`MethodNotFoundError: オブジェクトで '${fname}' 機能が見つかりません。`);
        return val;
      } else if (typeof callee === 'string') {
        if (['数字に', '文字に', '文字列に', 'コードに', '字に'].includes(callee)) {
           const args = [];
           for (const a of expr.arguments) args.push(await this.evaluate(a, env));
           if (callee === '数字に') {
             const res = Number(args[0]);
             if (isNaN(res)) throw new Error("ConversionError: 数字に変換できない値です。");
             return res;
           }
           if (callee === '文字列に') return this.format_value(args[0]);
           if (callee === 'コードに') {
             if (typeof args[0] !== 'string' || Array.from(args[0]).length !== 1) throw new Error("ConversionError: 一文字だけ変換できます。");
             return args[0].codePointAt(0);
           }
           if (callee === '文字に') {
             return String.fromCodePoint(args[0]);
          }
        }
        
        const func_decl = this.functions[callee];
        if (!func_decl) throw new Error(`ReferenceError: 関数 '${callee}'が見つかりません。`);
        if (func_decl.type === 'BuiltinFunction') {
          const args = [];
          for (const a of expr.arguments) {
            args.push(await this.evaluate(a, env));
          }
          return func_decl.execute(args);
        }
        
        const local_env = new Environment(env);
        const params = func_decl.params || [];
        if (expr.arguments.length > params.length) throw new Error("ArgumentError: 関数に渡された引数の数が多すぎます。");
        for (let i = 0; i < params.length; i++) {
          if (i < expr.arguments.length) {
            local_env.declare(params[i].name, await this.evaluate(expr.arguments[i], env), false);
          } else if (params[i].default) {
            local_env.declare(params[i].name, await this.evaluate(params[i].default, env), false);
          } else {
            throw new Error("MissingArgumentError: 関数の実行に必要な引数が欠落しています。");
          }
        }
        try {
          for (const bs of func_decl.body) await this.execute(bs, local_env);
        } catch (e: any) {
          if (e.name === 'ReturnValue') return e.value;
          throw e;
        }
        return null;
      }
    } else if (t === 'BinaryExpression') {
      const op = expr.operator;
      // Logical short-circuit
      if (op === 'そして' || op === 'かつ' || op === 'または') {
        const l = await this.evaluate(expr.left, env);
        if (op === 'そして' || op === 'かつ') return l ? await this.evaluate(expr.right, env) : false;
        if (op === 'または') return l ? true : await this.evaluate(expr.right, env);
      }
      
      const l = await this.evaluate(expr.left, env);
      const r = await this.evaluate(expr.right, env);

      // Operator overloading
      if (l instanceof KanadeObject) {
        let op_method = '';
        if (op === '==') op_method = '記号 同じだ';
        if (op === '+') op_method = '記号 足そう';
        // Check if method exists
        const find_method = (cname: string): boolean => {
          const cast = this.classes[cname];
          if (!cast) return false;
          if (cast.body.some((s: any) => s.type === 'FunctionDeclaration' && s.id === op_method)) return true;
          if (cast.baseClass) return find_method(cast.baseClass.name || cast.baseClass);
          return false;
        };
        
        if (op_method && find_method(l.cls_name)) {
          const fake_callee = { type: "BoundMethod", object: l, func_name: op_method };
          const res = await this.evaluate({ type: "CallExpression", callee: fake_callee, arguments: [expr.right], is_fake: true }, env);
          if (op === '!=') return !res;
          return res;
        }
      }

      if (op === '==') return l === r;
      if (op === '!=') return l !== r;
      if (op === '>') return l > r;
      if (op === '<') return l < r;
      if (op === '>=') return l >= r;
      if (op === '<=') return l <= r;
      if (op === '+') {
         if (typeof l === 'string' || typeof r === 'string') {
            if (typeof l !== 'string' || typeof r !== 'string') throw new Error("TypeError: 文字列と他のタイプは足せません。");
         }
         return l + r;
      }
      if (op === '*') return l * r;
      if (op === '-') return l - r;

      if (op === '/' || op === '%') {
        if (r === 0) {
          throw new Error("DivideByZeroError: 0で割ることはできません。");
        }
        return op === '/' ? l / r : l % r;
      }

      if (op === 'instanceof') {
          let checkType = null;
          if (typeof r === 'string') checkType = r;
          else if (r && r.type === 'TypeReference') checkType = r.name;
          
          if (checkType) {
            const r_str = checkType;
            if (r_str === '文字') return typeof l === 'string';
            if (r_str === '数字') return typeof l === 'number';
            if (r_str === '真偽') return typeof l === 'boolean';
            if (r_str === 'リスト' || r_str === 'リスト') return Array.isArray(l);
            if (r_str === '辞書') return l !== null && typeof l === 'object' && !Array.isArray(l) && !(l instanceof KanadeObject);
            if (l instanceof KanadeObject) {
              let clsName: string | null = l.cls_name;
              while (clsName) {
                if (clsName === r_str) return true;
                const c = this.classes[clsName];
                clsName = c && c.baseClass ? (c.baseClass.name || c.baseClass) : null;
              }
              let currentCls: string | null = l.cls_name;
              while (currentCls) {
                const c = this.classes[currentCls];
                if (c && c.interfaces) {
                  for (const iface of c.interfaces) {
                    if ((iface.name || iface) === r_str) return true;
                  }
                }
                currentCls = c && c.baseClass ? (c.baseClass.name || c.baseClass) : null;
              }
            }
          }
                  return false;
        }
        return false;
    } else if (t === 'LogicalExpression') {
      const l = await this.evaluate(expr.left, env);
      const op = expr.operator;
      if (op === 'そして' || op === 'かつ') {
        if (!l) return false;
        return await this.evaluate(expr.right, env);
      } else if (op === 'または') {
        if (l) return true;
        return await this.evaluate(expr.right, env);
      }
    }
    return null;
  }
}




