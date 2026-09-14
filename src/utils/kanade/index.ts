import { Lexer } from './lexer';
import { Parser } from './parser';
import { KanadeInterpreter } from './interpreter';
import { KanadeError, KanadeRuntimeError } from './types';

export async function runHaja(code: string, inputCallback?: (promptText: string) => Promise<string>, outputCallback?: (msg: string) => void): Promise<string> {
  try {
    const lexer = new Lexer(code);
    const parser = new Parser(lexer.tokens);
    const ast = parser.parse_program();
    const interpreter = new KanadeInterpreter(ast, inputCallback, outputCallback);
    return await interpreter.run();
  } catch (e: any) {
    if (e instanceof KanadeError) {
      throw `構文エラー: ${e.line}번째 줄\n${e.message}`;
    }
    if (e instanceof KanadeRuntimeError) {
      throw `ランタイムエラー:\n${e.message}`;
    }
    throw `不明なエラー:\n${e.stack || e.message || String(e)}`;
  }
}
