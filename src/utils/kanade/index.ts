import { Lexer } from "./lexer";
import { Parser } from "./parser";
import { KanadeInterpreter } from "./interpreter";
import { KanadeError, KanadeRuntimeError, KanadeSyntaxReport } from "./errors";
import { registerStandardLibrary } from "./stdlib";
import { JapaneseConfig } from "./config";
import { localize, syntaxError } from "./errs";

// runKanade — renamed from the previous ad hoc engine's copy-pasted
// `runHari` (a leftover from forking hari-docs' engine that was never
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
    const problems = parser.diagnostics;
    if (problems.length > 0) {
      // Like `hana run`: a file with syntax errors is reported, not run.
      const lines = problems.map((d) => localize(JapaneseConfig.locale, syntaxError(d))).join("\n");
      throw new KanadeSyntaxReport(`構文エラー: ${problems[0].line}行目\n${lines}`);
    }
    const interpreter = new KanadeInterpreter(ast, inputCallback, outputCallback);
    registerStandardLibrary(interpreter);
    return await interpreter.run();
  } catch (e: any) {
    if (e instanceof KanadeSyntaxReport) throw e.message;
    if (e instanceof KanadeError) {
      throw `構文エラー: ${e.line}行目\n${e.message}`;
    }
    if (e instanceof KanadeRuntimeError) {
      throw `ランタイムエラー:\n${e.message}`;
    }
    throw `不明なエラー:\n${e.stack || e.message || String(e)}`;
  }
}
