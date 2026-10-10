# Infinity Rally

打ち込まれても、ドロップで揺さぶられても、走りまくってギリギリで返す。
終わらないテニスのラリーをただ眺めるための Web アプリ（Three.js）。

## 見方
- 画面クリック / `C` キー: カメラ切替（TV・背後・サイド・周回・ローアングル）
- 下のボタン: カメラ自動切替 / ギリギリの瞬間のスロー / 打球音 / 全画面
- 操作しないとボタンは自動で消えます

## ローカル実行
```sh
npx http-server -p 8123 .
# http://localhost:8123/        (?speed=4 で早送り・デバッグ用)
```

## 公開（GitHub Pages）
`main` に push すると GitHub Actions が自動デプロイします。
初回のみ: リポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** にしてください。

## バージョン表記
画面右下に `vX.Y.Z  YYYY-MM-DD HH:MM JST` を表示します。
- `X.Y` は `VERSION` ファイル（大きな変更のときに手で上げる）
- `Z` はデプロイ実行番号（公開するたびに自動で増える）
- 日時はデプロイ時刻（日本時間）
