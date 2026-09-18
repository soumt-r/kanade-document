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
