// Mirrors hana/stdlib/builtins.go's RegisterStandardLibrary. Go calls this
// from cmd/run.go right after vm.NewInterpreter(...); this repo's index.ts
// does the same right after `new KanadeInterpreter(...)`. The four conversion
// builtins (文字列に/数字に/コードに/文字に) are what tutorial/1-variables.md's
// conversion-utility section demonstrates — global functions callable without
// an import, unlike 数学 (which stays registered-but-unreachable here since
// this engine's ImportStatement handling blanket-refuses every import,
// native modules included — see execStmt.ts's ImportStatement case; that
// matches this repo's previous ad hoc engine's own behavior, not a new gap).
// Error message text below stays Korean even here — Go's own
// hana/stdlib/builtins.go hardcodes the same Korean strings regardless of
// KoreanConfig/JapaneseConfig, so this mirrors that faithfully rather than
// translating text Go itself never localizes.
import { BuiltinFunction, type NativeModule } from "./object";
import type { KanadeInterpreter } from "./interpreter";

export function registerStandardLibrary(i: KanadeInterpreter): void {
  const cfg = i.config;

  i.registerBuiltin(cfg.builtinToString, (_env, ...args) => {
    if (args.length !== 1) throw new Error("ArgumentError: 1개의 인자가 필요합니다.");
    return i.formatValue(args[0]);
  });

  i.registerBuiltin(cfg.builtinToNumber, (_env, ...args) => {
    if (args.length !== 1) throw new Error("ArgumentError: 1개의 인자가 필요합니다.");
    const v = args[0];
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const num = Number(v);
      if (Number.isNaN(num) || v.trim() === "") throw new Error(`ConversionError: '${v}'을(를) 숫자로 바꿀 수 없습니다.`);
      return num;
    }
    throw new Error("ConversionError: 숫자로 바꿀 수 없는 값입니다.");
  });

  i.registerBuiltin(cfg.builtinToCode, (_env, ...args) => {
    if (args.length !== 1) throw new Error("ArgumentError: 1개의 인자가 필요합니다.");
    const s = args[0];
    if (typeof s !== "string" || Array.from(s).length !== 1) {
      throw new Error("ConversionError: <코드로>는 길이가 1인 문자열이 필요합니다.");
    }
    return s.codePointAt(0)!;
  });

  i.registerBuiltin(cfg.builtinToText, (_env, ...args) => {
    if (args.length !== 1) throw new Error("ArgumentError: 1개의 인자가 필요합니다.");
    const num = args[0];
    if (typeof num !== "number") throw new Error("ConversionError: 숫자가 아닌 값은 글자로 바꿀 수 없습니다.");
    return String.fromCodePoint(num);
  });

  const mathModule: NativeModule = {
    [cfg.mathCeil]: new BuiltinFunction(cfg.mathCeil, (_env, ...args) => {
      if (args.length !== 1) throw new Error("ArgumentError: 1개의 인자가 필요합니다.");
      if (typeof args[0] !== "number") throw new Error("TypeError: 숫자가 아닙니다.");
      return Math.ceil(args[0]);
    }),
    [cfg.mathFloor]: new BuiltinFunction(cfg.mathFloor, (_env, ...args) => {
      if (args.length !== 1) throw new Error("ArgumentError: 1개의 인자가 필요합니다.");
      if (typeof args[0] !== "number") throw new Error("TypeError: 숫자가 아닙니다.");
      return Math.floor(args[0]);
    }),
  };
  i.registerNativeModule(cfg.pkgMath, mathModule);
}
