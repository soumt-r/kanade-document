// Mirrors hana/stdlib/builtins.go's RegisterStandardLibrary. Go calls this
// from cmd/run.go right after vm.NewInterpreter(...); this repo's index.ts
// does the same right after `new KanadeInterpreter(...)`. The four conversion
// builtins (文字列に/数字に/コードに/文字に) are what tutorial/1-variables.md's
// conversion-utility section demonstrates — global functions callable without
// an import, unlike 数学 (which stays registered-but-unreachable here since
// this engine's ImportStatement handling blanket-refuses every import,
// native modules included — see execStmt.ts's ImportStatement case; that
// matches this repo's previous ad hoc engine's own behavior, not a new gap).
import { BuiltinFunction, type NativeModule } from "./object";
import type { KanadeInterpreter } from "./interpreter";
import { RuntimeError, Codes } from "./errs";

export function registerStandardLibrary(i: KanadeInterpreter): void {
  const cfg = i.config;

  i.registerBuiltin(cfg.builtinToString, (_env, ...args) => {
    if (args.length !== 1) throw new RuntimeError(Codes.ArgCountExact, 1);
    return i.formatValue(args[0]);
  });

  i.registerBuiltin(cfg.builtinToNumber, (_env, ...args) => {
    if (args.length !== 1) throw new RuntimeError(Codes.ArgCountExact, 1);
    const v = args[0];
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const num = Number(v);
      if (Number.isNaN(num) || v.trim() === "") throw new RuntimeError(Codes.ConvertToNumberFailed, v);
      return num;
    }
    throw new RuntimeError(Codes.ConvertToNumberInvalid);
  });

  i.registerBuiltin(cfg.builtinToCode, (_env, ...args) => {
    if (args.length !== 1) throw new RuntimeError(Codes.ArgCountExact, 1);
    const s = args[0];
    if (typeof s !== "string" || Array.from(s).length !== 1) {
      throw new RuntimeError(Codes.ConvertToCodeNeedsOneChar, cfg.builtinToCode);
    }
    return s.codePointAt(0)!;
  });

  i.registerBuiltin(cfg.builtinToText, (_env, ...args) => {
    if (args.length !== 1) throw new RuntimeError(Codes.ArgCountExact, 1);
    const num = args[0];
    if (typeof num !== "number") throw new RuntimeError(Codes.ConvertToTextNeedsNumber);
    return String.fromCodePoint(num);
  });

  const mathModule: NativeModule = {
    [cfg.mathCeil]: new BuiltinFunction(cfg.mathCeil, (_env, ...args) => {
      if (args.length !== 1) throw new RuntimeError(Codes.ArgCountExact, 1);
      if (typeof args[0] !== "number") throw new RuntimeError(Codes.NotANumber);
      return Math.ceil(args[0]);
    }),
    [cfg.mathFloor]: new BuiltinFunction(cfg.mathFloor, (_env, ...args) => {
      if (args.length !== 1) throw new RuntimeError(Codes.ArgCountExact, 1);
      if (typeof args[0] !== "number") throw new RuntimeError(Codes.NotANumber);
      return Math.floor(args[0]);
    }),
  };
  i.registerNativeModule(cfg.pkgMath, mathModule);
}
