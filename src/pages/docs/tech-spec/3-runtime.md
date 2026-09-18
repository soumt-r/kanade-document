---
layout: ../../../layouts/DocLayout.astro
title: 3. 実行機(Interpreter)とランタイム
description: カナデ(Kanade) 言語の実行機(Interpreter)とランタイムエラー仕様です。
---

## 3. インタープリタとランタイムについて

カナデ（Kanade）の実行機（インタープリタ）は、ハジャ（Haja）のインタープリタをそのまま使用しています。
実行時のスコープチェーン、変数の評価、関数呼び出し、エラーハンドリングの仕組みは全てハジャと同じです。

実行機およびランタイムエラーの詳細な仕様については、以下のハジャ（Haja）のドキュメントを参照してください。

* **[Haja 実行機・ランタイム仕様書](https://haja.soumt.moe/docs/tech-spec/3-runtime)**
