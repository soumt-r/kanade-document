// The Kanade editor look: white paper and ink text, with the logo's purple for verbs
// (作ろう/出力しよう) and its orange for particles (を/の/に).
// Shared by every CodeMirror instance (docs examples, side drawer, playground).
import { EditorView } from "codemirror";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

const ink = "#13131a";
const inkSoft = "#4b4b57";
const inkFaint = "#8b8b99";
const rule = "#e8e8ee";
const wash = "#f6f6f9";
const verb = "#8e2de2"; // 述語 (-しよう)
const particle = "#e8431f"; // 助詞 (を/の/に)
const green = "#0e7c66"; // strings
const indigo = "#4c5bd4"; // types
const magenta = "#b0189e"; // function names
const coral = "#c2410c"; // numbers, booleans

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: verb, fontWeight: "700" },
  { tag: t.meta, color: particle }, // particles
  { tag: t.string, color: green },
  { tag: t.number, color: coral },
  { tag: t.bool, color: coral, fontWeight: "700" },
  { tag: t.typeName, color: indigo },
  { tag: t.propertyName, color: magenta },
  { tag: t.variableName, color: ink },
  { tag: t.comment, color: inkFaint, fontStyle: "italic" },
  { tag: t.operator, color: inkSoft },
  { tag: t.bracket, color: inkSoft },
]);

export function kanadeTheme(opts: { height?: string; maxHeight?: string; fontSize?: string } = {}) {
  return [
    EditorView.theme({
      "&": {
        height: opts.height ?? "auto",
        maxHeight: opts.maxHeight,
        fontSize: opts.fontSize ?? "14.5px",
        color: ink,
        backgroundColor: "#ffffff",
      },
      "&.cm-focused": { outline: "none" },
      ".cm-scroller": {
        fontFamily: '"D2Coding", ui-monospace, "Cascadia Mono", monospace',
        lineHeight: "1.85",
        overflow: "auto",
      },
      ".cm-content": { caretColor: verb, padding: "0.75rem 0" },
      ".cm-cursor": { borderLeftColor: verb, borderLeftWidth: "2px" },
      ".cm-gutters": { backgroundColor: wash, borderRight: `1px solid ${rule}`, color: inkFaint },
      ".cm-activeLine": { backgroundColor: wash },
      ".cm-activeLineGutter": { backgroundColor: "#ececf2", color: ink },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "#f1e6fc" },
      ".cm-tooltip": { border: `1px solid ${rule}`, backgroundColor: "#ffffff", borderRadius: "2px" },
      ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: verb, color: "#ffffff" },
    }),
    syntaxHighlighting(highlight),
  ];
}
