# PixelScience Games

遊んでわかる！科学の「なぜ？」 — YouTube チャンネル PixelScience の科学ミニゲーム集。
指一本で遊べる6本のゲームと、99の「なぜ？」図鑑。スマホのホーム画面に追加して、アプリのように遊べます。

## ファイル
- `index.html` — ゲーム本体（これだけを編集する）
- `build.mjs` — 公開用サイトを `docs/` に作る（アイコン・manifest・オフライン用 service worker も）
- `serve.mjs` — 手元で確認するサーバー（http://localhost:5178 、公開版は /docs/）
- `docs/` — GitHub Pages で公開されるサイト（build.mjs が作る。手で編集しない）

公開URL: https://pixelscience-games.github.io/

- `site.config.json` — 公開URLと Google アナリティクスの測定ID（build.mjs が読む）

## 更新のしかた
```bash
node build.mjs
git add -A && git commit -m "更新内容" && git push
```
