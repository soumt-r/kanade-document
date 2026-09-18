// Mirrors hana/vm/config.go's LangConfig shape, with this repo's own
// JapaneseConfig values (haja-docs' config.ts carries KoreanConfig instead —
// no runtime language switching inside one repo, per the "구조만 미러링,
// 레포는 분리" decision).
import type { Expression } from "./ast";
import type { Locale } from "./errs";

export interface LangConfig {
  builtinToString: string;
  builtinToNumber: string;
  builtinToCode: string;
  builtinToText: string;
  pkgMath: string;
  mathCeil: string;
  mathFloor: string;
  nativePrefix: string;
  defaultItemName: string;
  defaultIndexName: string;
  nullString: string;
  objectFormat: string; // e.g. "[%s オブジェクト]" — %s replaced with the class name
  trueString: string;
  falseString: string;
  selfWords: string[];
  pluralSelfWords: string[];
  builtinErrorClass: string;
  builtinErrorMessage: string;
  builtinErrorCtorArg: string;
  listClearMethod: string;
  lengthWord: string;
  varQuoteOpen: string;
  varQuoteClose: string;
  stringSliceMethod: string;
  stringReplaceMethod: string;
  stringSplitMethod: string;
  stringContainsMethod: string;

  // equalsMethodName is the magic method evalExpr.ts's BinaryExpression
  // case looks for on a HajaObject operand of ==/!= (operator overloading).
  // Mirrors Go's vm/config.go EqualsMethodName — was hardcoded to Korean
  // "기호 같다" regardless of language until a real kanade-docs example
  // (oop/1-classes.md's 〈記号 同じだ〉) was found to never match.
  equalsMethodName: string;

  // locale picks the wording errs.localize renders a runtime error in wherever
  // it becomes user-visible text (a `発生したら` handler's caught message, the
  // Playground's error output). Mirrors vm.LangConfig.Locale.
  locale: Locale;

  parseEmbeddedExpr?: (code: string) => Expression;
}

function isSelfWord(cfg: LangConfig, v: string): boolean {
  return cfg.selfWords.includes(v);
}

function isPluralSelfWord(cfg: LangConfig, v: string): boolean {
  return cfg.pluralSelfWords.includes(v);
}

export const LangConfigUtil = { isSelfWord, isPluralSelfWord };

// kanade-docs' actual doc content (tutorial/1-variables.md, tutorial/3-strings.md)
// is the source of truth for these literals, not a guess — see hana/CLAUDE.md
// for the story of values that were wrong before being checked against real
// doc examples.
export const JapaneseConfig: LangConfig = {
  builtinToString: "文字列に",
  builtinToNumber: "数字に",
  builtinToCode: "コードに",
  builtinToText: "文字に",
  pkgMath: "数学",
  mathCeil: "切り上げ",
  mathFloor: "切り捨て",
  nativePrefix: "ネイティブ_",
  defaultItemName: "アイテム",
  defaultIndexName: "インデックス",
  nullString: "空っぽ",
  objectFormat: "[%s オブジェクト]",
  trueString: "真",
  falseString: "偽",
  selfWords: ["私"],
  pluralSelfWords: ["私たち"],
  builtinErrorClass: "エラー",
  builtinErrorMessage: "メッセージ",
  builtinErrorCtorArg: "初期メッセージ",
  listClearMethod: "空にする",
  lengthWord: "長さ",
  varQuoteOpen: "『",
  varQuoteClose: "』",
  stringSliceMethod: "切り取り",
  stringReplaceMethod: "入れ替え",
  stringSplitMethod: "分割",
  stringContainsMethod: "含むか確認",
  // kanade-docs/src/pages/docs/oop/1-classes.md's actual method name
  // (〈記号 同じだ〉, delimiters stripped).
  equalsMethodName: "記号 同じだ",
  locale: "ja",
};
