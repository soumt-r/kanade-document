---
layout: ../../../layouts/DocLayout.astro
title: 2. 構文木(AST) 構造
description: カナデ(Kanade) 言語の抽象構文木(AST)仕様です。
---

このドキュメントは、パーサー（`Parser`）が生成するAST（Abstract Syntax Tree、抽象構文木）のノードごとのJSONスキーマを定義しています。カナデのインタープリタ、コンパイラ、静的解析ツールなど、すべてのツールがこの仕様を基準に実装されています。

カナデのASTは、ハジャ（Hari）とまったく同じノード構造です。パーサーが日本語のキーワードを読み取ったあとに生成されるJSONは、ハジャと完全に互換性があります。違いは区切り記号と語彙だけなので、各ノードの下に書いてあるカナデの書き方（`『変数』`、`【タイプ】`、`〈関数〉`）とJSONの対応を見れば、ハジャのドキュメントもそのまま読み替えられます。語彙の対応は[言語概要](/docs/tech-spec/1-overview)の表にまとめてあります。

## 1. プログラム (Program)
すべてのソースコードの最上位ノードです。
```json
{
  "type": "Program",
  "body": [ /* Statementノードの一覧 */ ]
}
```

## 2. 宣言と代入 (Declarations & Assignments)

### VariableDeclaration (変数の宣言と値の代入)
`(『私たち』の)『名前』を(【タイプ】の)値にしよう/固定しよう/準備しよう`
（参考：パーサーは変数の宣言と値の再代入を区別せず、どちらもこのノードとして読み取ります。新しい変数を作るのか再代入なのかは、ランタイムが決めます。）
```json
{
  "type": "VariableDeclaration",
  "target": /* Identifier、またはMemberExpression（オブジェクトのプロパティに代入する場合） */,
  "isStatic": false, // 『私たち』の が付いていればtrue
  "accessModifier": "public", // クラスのフィールドなら"public"、"private"、"protected"のどれか（指定がなければpublic）
  "typeAnnotation": { "type": "TypeReference", "name": "タイプ" }, // タイプの指定がなければnull
  "value": /* Expressionノード（準備しようの場合、またはプロパティアクセサの場合はnull） */,
  "isConst": false, // 固定しようの場合true
  "isDeclarationOnly": false, // 準備しようの場合true
  "getter": [ /* Statementノードの一覧（プロパティアクセサの「取得する時」ブロック、なければnull） */ ],
  "setter": {
    "param": { "type": "Identifier", "name": "新しい値" },
    "body": [ /* Statementノードの一覧（プロパティアクセサの「決める時」ブロック） */ ]
  } // プロパティアクセサの「決める時」ブロック、なければnull
}
```

### Compound Assignments (複合代入)
`『名前』に値を足そう/引こう` など
```json
{
  "type": "CompoundAssignment",
  "operator": "+=", // 足そうは"+="、引こうは"-="など
  "target": /* Identifier、またはMemberExpression */,
  "value": /* Expressionノード */
}
```

### List Operations (リスト専用の操作)
`『リスト』(の前に/の後に/に)値を追加しよう`
```json
{
  "type": "ListPushStatement",
  "target": /* Identifier、またはMemberExpression */,
  "value": /* Expressionノード */,
  "position": "back" // "front"（前に）、"back"（後に／既定値）
}
```

`『リスト』(の前から/の後から/から)取り出そう`
```json
{
  "type": "ListPopStatement",
  "target": /* Identifier、またはMemberExpression */,
  "position": "back" // "front"（前から）、"back"（後から／既定値）
}
```

`『リスト』(の前から/の後から/から)取り出した値`（Expressionノード）
```json
{
  "type": "ListPopExpression",
  "target": /* Identifier、またはMemberExpression */,
  "position": "back" // "front"、"back"
}
```

## 3. 制御フロー (Control Flow)

### IfStatement (条件文)
`もし(条件)なら: ... もしくは(条件)なら: ... それ以外ならば: ...`
```json
{
  "type": "IfStatement",
  "condition": /* Expressionノード */,
  "consequent": [ /* Statementノードの一覧 */ ],
  "elifs": [
    {
      "condition": /* Expressionノード */,
      "consequent": [ /* Statementノードの一覧 */ ]
    }
  ],
  "alternate": [ /* Statementノードの一覧（なければ空のリスト） */ ]
}
```

### SwitchStatement (スイッチ文)
`『値』によって分けよう: 「場合1」の場合: ... 残りは: ...`
```json
{
  "type": "SwitchStatement",
  "discriminant": /* Expressionノード */,
  "cases": [
    {
      "values": [ /* Expressionノードの一覧（読点で複数の条件を書ける） */ ],
      "body": [ /* Statementノードの一覧 */ ]
    }
  ],
  "default": [ /* Statementノードの一覧（省略可、なければnull） */ ]
}
```

### FallthroughStatement (スイッチの貫通)
`次に続けよう`
```json
{
  "type": "FallthroughStatement"
}
```

### WhileLoop (条件付き繰り返し)
`(条件)間繰り返そう:`
```json
{
  "type": "WhileLoop",
  "condition": /* Expressionノード */,
  "body": [ /* Statementノードの一覧 */ ]
}
```

### ForEachLoop (リストの巡回)
`『リスト』の『項目』ごとに繰り返そう:`
```json
{
  "type": "ForEachLoop",
  "item": { "type": "Identifier", "name": "項目" }, // 1つずつ取り出す要素のIdentifierノード
  "iterable": /* Expressionノード（評価結果がリストまたは文字列でなければならない） */,
  "body": [ /* Statementノードの一覧 */ ]
}
```

### ForRangeStatement (数の範囲の繰り返し)
`1から10まで繰り返そう(『回数』):` または `『開始』から『終了』まで繰り返そう(『回数』):`
```json
{
  "type": "ForRangeStatement",
  "start": /* Expressionノード */,
  "end": /* Expressionノード */,
  "iterator": { "type": "Identifier", "name": "回数" }, // 繰り返しの変数のIdentifierノード
  "body": [ /* Statementノードの一覧 */ ]
}
```

### BreakStatement (繰り返しの中断)
`繰り返しを終わろう`
```json
{
  "type": "BreakStatement"
}
```

## 4. 関数とオブジェクト指向 (Functions & OOP)

### FunctionDeclaration (関数・メソッドの宣言)
`【戻り値の型】を返す(『私たち』の)〈関数名〉を作ろう(【タイプ】の『引数』 = 「デフォルト値」):`
```json
{
  "type": "FunctionDeclaration",
  "id": "関数名",
  "isStatic": false, // 『私たち』の が付いていればtrue
  "accessModifier": "public", // "public"、"private"、"protected"のどれか（指定がなければpublic）
  "returnType": { "type": "TypeReference", "name": "戻り値の型" }, // 指定がなければnull
  "isAbstract": false, // 抽象メソッド（本体がない場合）ならtrue
  "params": [
    {
      "type": { "type": "TypeReference", "name": "タイプ" }, // 指定がなければnull
      "name": "引数の名前",
      "default": /* Expressionノード（デフォルト値がなければnull） */
    }
  ],
  "body": [ /* Statementノードの一覧（isAbstractがtrueならnull） */ ]
}
```

### ReturnStatement (return文)
`『値』を返そう` または `返そう`
```json
{
  "type": "ReturnStatement",
  "value": /* Expressionノード（値を省略した場合はnull） */
}
```

### ClassDeclaration (クラスの宣言)
`【親クラス】をもとにして【インターフェース】に従う【(タイプ)クラス名】を設計しよう/下設計しよう:`
```json
{
  "type": "ClassDeclaration",
  "id": "クラス名",
  "typeParams": [ "タイプ" ], // ジェネリクスの型パラメータ（なければ空のリスト）
  "isAbstract": false, // 抽象クラスとして宣言した場合true
  "baseClass": { "type": "TypeReference", "name": "親クラス名" }, // 継承する親クラス1つ（なければnull）
  "interfaces": [ /* TypeReferenceノードの一覧（なければ空のリスト） */ ], // 実装するインターフェースの一覧
  "body": [ /* FunctionDeclaration、ConstructorDeclarationなど */ ]
}
```

### ConstructorDeclaration (コンストラクタの宣言)
`最初に作られる時(『引数』)次のようにしよう:`
```json
{
  "type": "ConstructorDeclaration",
  "id": { "type": "Identifier", "name": "最初に作られる時" },
  "params": [ /* FunctionDeclarationと同じパラメータ構造 */ ],
  "body": [ /* Statementノードの一覧 */ ]
}
```

### InterfaceDeclaration (インターフェースの宣言)
`【インターフェース名】を規定しよう:`
```json
{
  "type": "InterfaceDeclaration",
  "id": "インターフェース名",
  "body": [ /* InterfaceMethodノードの一覧 */ ]
}
```

### InterfaceMethod (インターフェースのメソッド規約)
`〈メソッド名〉がなければならない(【タイプ】の『引数』)`
```json
{
  "type": "InterfaceMethod",
  "id": "メソッド名",
  "returnType": { "type": "TypeReference", "name": "戻り値の型" }, // 指定がなければnull
  "params": [ /* FunctionDeclarationと同じパラメータ構造 */ ]
}
```

## 5. 式と特殊な参照 (Expressions & Special References)

### BinaryExpression (二項演算)
`A + B`、`AがBと同じだ`、`AがBの一種だ` など
```json
{
  "type": "BinaryExpression",
  "left": /* Expressionノード */,
  "operator": "+", "-", "*", "/", "%", "==", "!=", "<", ">", "<=", ">=", "instanceof" /* 演算子の記号 */,
  "right": /* Expressionノード（ただし演算子が"instanceof"の場合はTypeReferenceノード） */
}
```

算術演算子の結び付きの順序は、普通の数学と同じです。`*` `/` `%`が`+` `-`より先に結び付き、同じ段階の演算子は左から結び付きます。そのため`2 + 3 * 4`は、`left: 2, operator: "+", right: (3 * 4)`という木になります。丸括弧で囲んだ式は、それ自体で1つの項です。

### LogicalExpression (論理演算)
`A かつ B`、`A または B`（短絡評価に対応）
```json
{
  "type": "LogicalExpression",
  "left": /* Expressionノード */,
  "operator": "かつ", "または",
  "right": /* Expressionノード */
}
```

### CallExpression (関数・メソッドの呼び出し)
`〈関数名〉(引数1, 引数2)`
```json
{
  "type": "CallExpression",
  "callee": /* Identifier、MemberExpression、またはFunctionReference */,
  "arguments": [ /* Expressionノードの一覧 */ ]
}
```

### NewExpression (インスタンスの生成)
`新しい【クラス名】(引数)`
```json
{
  "type": "NewExpression",
  "callee": {
    "type": "TypeReference",
    "name": "クラス名"
  },
  "arguments": [ /* Expressionノードの一覧 */ ]
}
```

### MemberExpression (プロパティ・メソッド・インデックスへのアクセス)
`『オブジェクト』の『プロパティ』`、`『リスト』の1番目`、`『辞書』の「キー」`
```json
{
  "type": "MemberExpression",
  "object": /* Expressionノード（または静的アクセスの場合はTypeReferenceノード） */,
  "property": /* Identifier（プロパティ）、FunctionReference（メソッド）、IndexExpression、LengthLiteral、またはLiteral（文字列のキー） */
}
```

### Special References (特殊な参照)
`親`、`外` の予約語
```json
// 親
{
  "type": "SuperReference"
}

// 外
{
  "type": "OuterReference"
}
```

### Identifier (変数名)
`『名前』`
```json
{
  "type": "Identifier",
  "name": "名前"
}
```

### FunctionReference (関数の参照)
静的な参照: `〈関数名〉`
動的な参照（リフレクション）: `〈『変数名』〉` または `〈「文字列」〉`
```json
{
  "type": "FunctionReference",
  "name": "関数名", // 静的な参照なら文字列、動的な参照ならnull
  "expression": /* Expressionノード（動的な参照ならIdentifierやLiteralなど、静的な参照ならnull） */
}
```

### ExpressionStatement (式文)
`〈関数〉()を実行しよう`のように、式そのものが1つの文（Statement）として使われるときのノードです。
```json
{
  "type": "ExpressionStatement",
  "expression": /* CallExpressionなどのExpressionノード */
}
```

### TypeReference (タイプの参照)
タイプの情報を表すノードです。
```json
{
  "type": "TypeReference",
  "name": "タイプ名",
  "typeArgs": [ /* TypeReferenceノードの一覧（ジェネリクスの引数、なければ空のリスト） */ ]
}
```

### Literal (基本のリテラル)
数字、文字列、真偽値（`真`、`偽`）、空値（`空っぽ`）のリテラル（テンプレートを除く）
```json
{
  "type": "Literal",
  "value": 42 /* 評価されたホスト言語の基本の値（例: 42, "こんにちは", true, false, null） */,
  "raw": "42" /* ソースコードの文字列（例: "42", "\"こんにちは\"", "真", "空っぽ"） */
}
```

### TemplateLiteral (テンプレートリテラル)
`枠「文字列 {『変数』} 文字列」`
```json
{
  "type": "TemplateLiteral",
  "strings": [ "文字列 ", " 文字列" ],
  "expressions": [ /* 埋め込まれたExpressionノードの一覧 */ ]
}
```

### ListLiteral (リスト)
`【1, 2, 3】`
```json
{
  "type": "ListLiteral",
  "elements": [ /* Expressionノードの一覧 */ ]
}
```

### DictLiteral (辞書)
`{「キー」:「値」}`
```json
{
  "type": "DictLiteral",
  "elements": [
    {
      "key": /* Expressionノード */,
      "value": /* Expressionノード */
    }
  ]
}
```

### IndexExpression (インデックスアクセス式)
`1番目`、`『インデックス変数』番目`（ここで`番目`はインデックスを表す必須の文法トークンです。読みやすさのために後ろに付く`の値`（`1番目の値`）のような言葉は、パーサーが無視する省略可能なトークン（シンタックスシュガー）です。）
```json
{
  "type": "IndexExpression",
  "index": /* Expressionノード（評価結果が必ず整数でなければならない） */
}
```

### LengthLiteral (長さ)
`長さ`
```json
{
  "type": "LengthLiteral",
  "value": "長さ"
}
```

## 6. モジュールと例外 (Modules & Exceptions)

### ImportStatement (モジュールの読み込み)
`「ファイル」から全部持ってこよう` または `【モジュール】から〈関数〉と〈関数2〉を持ってこよう`
```json
{
  "type": "ImportStatement",
  "module": {
    "kind": "user", // "user"（文字列リテラルのファイル）または"builtin"（タイプリテラルのモジュール）
    "name": "ファイルやモジュールの名前"
  },
  "imports": null // すべてを持ってくるときはnull、特定の項目だけなら一覧 ["関数名", "変数名"]
}
```

現在のハジャ・カナデの実装では、項目の一覧と`全部`かどうかを次のように持ちます。項目は`〈a〉と〈b〉を持ってこよう`のように助詞でつなぎ、別名（`〈切り上げ〉を〈丸め〉に`）は項目が1つのときだけ付けられます。`【モジュール】から全部持ってこよう`は、そのモジュールが宣言した関数・クラス・インターフェース（組み込みモジュールは関数のすべて）を持ってきます。

タイプリテラル（`【名前】`）で書いたモジュールは、標準ライブラリ、Hanaランタイムと一緒に配るパッケージ、インストールしたサードパーティのパッケージのどれかです。サードパーティのパッケージの名前は、`【github.com/owner/repo】`のようにgitのパスです。どれに当たるかは、モジュールを読み込む側（ローダー）が決めます。パーサーは`【名前】`をすべて`builtin`として読み取ります。持ってきた関数がそのモジュールの中の関数を呼べること（モジュールの範囲）は、[ランタイム仕様](/docs/tech-spec/3-runtime)の4.3にあります。

### TryStatement (例外処理文)
`とりあえずやってみよう: ... 発生したら(『エラー』): ... 最後はいつも: ...`
```json
{
  "type": "TryStatement",
  "block": [ /* Statementノードの一覧（tryブロック） */ ],
  "handlers": [ /* CatchClauseノードの配列（順に評価される） */ ],
  "finalizer": [ /* Statementノードの一覧（finallyブロック） */ ] // なければnull
}
```

### CatchClause (個別の例外処理ブロック)
`【エラーの種類】が発生したら(『エラー』):` または `発生したら(『エラー』):`
```json
{
  "type": "CatchClause",
  "catchType": { "type": "TypeReference", "name": "エラーの種類" }, // タイプの指定がなければnull（すべての例外を捕まえる）
  "param": { "type": "Identifier", "name": "エラーの識別子名" },
  "body": [ /* Statementノードの一覧 */ ]
}
```

### ThrowStatement (エラーの発生)
`新しい【エラー】(「メッセージ」)を発生させよう`
```json
{
  "type": "ThrowStatement",
  "error": /* Expressionノード（普通はNewExpressionで作った例外オブジェクト） */
}
```

## 7. 入出力とその他 (I/O & Others)

### PrintStatement (出力文)
`「メッセージ」を出力しよう`
```json
{
  "type": "PrintStatement",
  "value": /* Expressionノード */
}
```

### PrintInlineStatement (続けて出力する文)
`「メッセージ」を続けて出力しよう`
```json
{
  "type": "PrintInlineStatement",
  "value": /* Expressionノード */
}
```

### InputStatement (入力文)
`『変数』を【タイプ】で入力してもらおう` または `『変数』を入力してもらおう`
```json
{
  "type": "InputStatement",
  "target": { "type": "Identifier", "name": "変数" }, // 入力値を保存する変数のIdentifierノード
  "typeAnnotation": { "type": "TypeReference", "name": "タイプ" } // 期待するタイプ（省略すると既定で"文字列"）
}
```
