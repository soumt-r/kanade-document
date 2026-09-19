// Mirrors hana/parser/kanade/parser.go's kanadeProfile (which is itself just
// a *haja.LangProfile instance handed to the shared Go parser). This repo's
// parser.ts hardwires this directly instead — see haja-docs' langProfile.ts
// header comment for why ("구조만 미러링", no cross-repo shared package).
import type { Token } from "./token";

export enum LoopKind {
  ForEach,
  While,
  Range,
}

export interface Component {
  expr: import("./ast").Expression;
  particles: string[];
  // The `[타입]인 값` annotation this component had, if any (declared types).
  type: import("./ast").TypeReference | null;
}

export interface LangProfile {
  errorLiterals: string[];
  pluralSelfWords: string[];
  conditionThenWords: string[];
  poppedValueWord: string;
  memberParticle: string;
  typeInWord: string;
  templatePrefix: string;
  templateSuffix: string;
  constructorFunctionName: string;
  frontMarker: string;
  accessModifierFromVerb(literal: string): string;
  isConstVerb(literal: string): boolean;
  isPrintInlineVerb(literal: string): boolean;
  classifyLoop(verb: Token, components: Component[]): LoopKind;
  normalizeCompareOpSOV(op: string): string;
  normalizeCompareOpSVO(op: string): string;
  importAsParticles: string[];
  delimLen: number;
  typeOpen: string;
  typeClose: string;
}

export function literalIn(literal: string, options: string[]): boolean {
  return options.includes(literal);
}

export const kanadeProfile: LangProfile = {
  errorLiterals: ["エラー", "エラーが"],
  // 『私たち』(quoted, matching kanade-docs literally) — not "私達": a real
  // doctest run against kanade-docs content caught this, not a guess (see
  // hana/CLAUDE.md).
  pluralSelfWords: ["私たち", "『私たち』"],
  conditionThenWords: ["なら", "ならば"],
  poppedValueWord: "値",
  memberParticle: "の",
  typeInWord: "の", // kanade-docs reuses the member particle for this
  templatePrefix: "枠「",
  templateSuffix: "」",
  constructorFunctionName: "最初に作られる時",
  frontMarker: "前",
  delimLen: "「".length,
  typeOpen: "【",
  typeClose: "】",
  accessModifierFromVerb(literal: string): string {
    if (literal.endsWith("隠そう")) return "private";
    if (literal.endsWith("譲ろう")) return "protected";
    return "public";
  },
  isConstVerb(literal: string): boolean {
    return literal.endsWith("固定しよう");
  },
  isPrintInlineVerb(literal: string): boolean {
    return literal.endsWith("続けて出力しよう");
  },
  // Unlike 하자 (one "반복하자" verb, kind read off a trailing marker word),
  // the loop kind here is fused into the verb literal itself (see lexer.ts's
  // KW_LOOP regex) since unspaced Japanese text can't carry a separate
  // trailing marker word without it merging into the verb token.
  classifyLoop(verb: Token, _components: Component[]): LoopKind {
    if (verb.literal.startsWith("ごとに")) return LoopKind.ForEach;
    if (verb.literal.startsWith("間")) return LoopKind.While;
    return LoopKind.Range;
  },
  normalizeCompareOpSOV(op: string): string {
    if (op.includes("一種")) return "instanceof";
    if (op.includes("同じ") || op.includes("等しい")) return "==";
    if (op.includes("大きい")) return ">";
    if (op.includes("小さい")) return "<";
    if (op.includes("以上")) return ">=";
    if (op.includes("以下")) return "<=";
    if (op.includes("異なる") || op.includes("違う")) return "!=";
    return op;
  },
  normalizeCompareOpSVO(op: string): string {
    if (op === "同じだ" || op === "同じ" || op === "等しい") return "==";
    if (op === "異なる" || op === "違う") return "!=";
    return op;
  },
  importAsParticles: ["に"],
};
