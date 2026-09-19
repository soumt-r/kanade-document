## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)

## エンジンのエラーメッセージ (生成ファイルに注意)

`src/utils/kanade/errCatalog.ts` は `../hana` (Go) の `errs` カタログから**生成されるファイル**です。
直接編集しないでください。文言を変えるときは `hana/errs/{ko,ja,en}.go` を編集し、
`cd ../hana && go run ./cmd/errsgen ../haja-docs/src/utils/haja/errCatalog.ts ../kanade-docs/src/utils/kanade/errCatalog.ts`
で両リポジトリのファイルを再生成します (`-check` を付けると古いかどうかだけ確認)。
エンジンでエラーを投げるときは `throw new RuntimeError(Codes.X, ...)` (`errs.ts`) を使い、
日本語・韓国語の文字列リテラルを直接書かないでください。
`compare_tests.ts` は Go エンジンと出力だけでなく最終的なエラーメッセージも比較します。

`src/utils/kanade/stdNames.ts` も `../hana` (Go) の `std` 名前表から**生成されるファイル**です。直接編集せず、`hana/std` を編集してから
`cd ../hana && go run ./cmd/stdgen -haja ../haja-docs/src/utils/haja/stdNames.ts -kanade ../kanade-docs/src/utils/kanade/stdNames.ts`
で再生成します (`-check` で最新かどうか確認)。新しいネイティブ関数の動作は `stdImpls.ts` の `nativeImpls` に ID で実装します (Go の `hana/std/stdimpl` を手でミラーしたものです。先に Go を直してここを合わせてください。`compare_tests.ts` の「표준:」ケースが結果を比べます)。

構文エラーも Go と同じです。パーサーが未知のトークン・文字を `parser.diagnostics`(行・列)に集め、`index.ts`(実行)と `kanadeLSP.ts`(エディタの下線)が `errs.ts` の `syntaxError`/`message` で同じ文言を出します。文言は `hana/errs` の `SyntaxError.*` コードから生成され、`compare_tests.ts` が Go と比較します。

`src/utils/kanade/lspKeywords.ts` も `hana/lsp` のキーワード表から**生成されるファイル**です(`kanadeLSP.ts` の補完が使用)。直接編集せず、`cd ../hana && go run ./cmd/lspgen -haja ../haja-docs/src/utils/haja/lspKeywords.ts -kanade ../kanade-docs/src/utils/kanade/lspKeywords.ts` で再生成します(`-check` で最新かどうか確認)。

宣言した型の検査(`typecheck.ts`, `types.ts`)は Go の `typecheck` / `vm/types.go` と同じ規則を手で写したものです。規則を変えるときは先に Go を直し、ここを合わせます。`compare_tests.ts` の「타입:」ケースが文言まで比較します。
