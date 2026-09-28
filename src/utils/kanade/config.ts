// Mirrors hana/vm/config.go's LangConfig shape, with this repo's own
// JapaneseConfig values (hari-docs' config.ts carries KoreanConfig instead —
// no runtime language switching inside one repo, per the "구조만 미러링,
// 레포는 분리" decision).
import type { Expression } from "./ast";
import type { Locale } from "./errs";
import type { TypeNames } from "./typecheck";

export interface LangConfig {
  builtinToString: string;
  builtinToNumber: string;
  builtinToCode: string;
  builtinToText: string;
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

  // operatorMethods names the method each operator calls on an object on its
  // left, by the operator's symbol ("==" for both == and !=; spec 3.5).
  // Mirrors Go's magic.Hari / magic.Kanade.
  operatorMethods: Record<string, string>;

  // locale picks the wording errs.localize renders a runtime error in wherever
  // it becomes user-visible text (a `発生したら` handler's caught message, the
  // Playground's error output). Mirrors vm.LangConfig.Locale.
  locale: Locale;

  // The names of the built-in types (declared-type checks and 입력받자 use them).
  types: TypeNames;

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
  operatorMethods: { "==": "記号 同じだ", "+": "記号 足す", "-": "記号 引く", "*": "記号 掛ける", "/": "記号 割る", "%": "記号 余り", ">": "記号 大きい", "<": "記号 小さい", ">=": "記号 以上", "<=": "記号 以下" },
  locale: "ja",
  types: { number: "数字", string: "文字列", boolean: "論理", any: "何でも", list: "リスト", dict: "辞書", null: "空っぽ" },
};

// Bounds nested calls so runaway recursion becomes a catchable RecursionError,
// the same number as hana's vm.MaxCallDepth.
export const MAX_CALL_DEPTH = 10000;
