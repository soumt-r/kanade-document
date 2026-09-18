import { Lexer } from "./lexer";
import { Parser } from "./parser";
import { KanadeInterpreter } from "./interpreter";
import { KanadeError, KanadeRuntimeError } from "./errors";
import { registerStandardLibrary } from "./stdlib";

// runKanade — renamed from the previous ad hoc engine's copy-pasted
// `runHaja` (a leftover from forking haja-docs' engine that was never
// actually renamed; playground.astro's import/call site is updated to match).
export async function runKanade(
  code: string,
  inputCallback?: (promptText: string) => Promise<string>,
  outputCallback?: (msg: string) => void,
): Promise<string> {
  try {
    const lexer = new Lexer(code);
    const parser = new Parser(lexer.tokens);
    const ast = parser.parseProgram();
    const interpreter = new KanadeInterpreter(ast, inputCallback, outputCallback);
    registerStandardLibrary(interpreter);
    return await interpreter.run();
  } catch (e: any) {
    if (e instanceof KanadeError) {
      throw `構文エラー: ${e.line}行目\n${e.message}`;
    }
    if (e instanceof KanadeRuntimeError) {
      throw `ランタイムエラー:\n${e.message}`;
    }
    throw `不明なエラー:\n${e.stack || e.message || String(e)}`;
  }
}
