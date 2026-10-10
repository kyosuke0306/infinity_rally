# infinity rally

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

## 3D モデル
- `assets/player.glb`: 選手モデル（2人で共用。攻撃側は白いウェアをシェーダーで赤に変えて表示）
- 作り方: Gemini で参考画像を生成（`tools/gemini_ref.py`、画像は `art/ref1.png`）→ Tripo で 3D モデル化・自動リグ・走りアニメ（`tools/tripo.py`）
- API キーは環境変数（`GEMINI_API_KEY` / `TRIPO_API_KEY`）でのみ使い、公開ページには入れない
- Tripo のアニメーションは 1 回のリクエストで 1 つだけ頼む（複数まとめて頼むと失敗する）
- アニメーション: run（走り）/ dive（飛び込み）/ idle（攻撃側の待ち）/ slash（スマッシュと、構えの姿勢）を 1 本ずつ作り、`tools/merge_anims.py` で 1 ファイルにまとめた
- 使った費用: Tripo 95 クレジット（モデル 30 + リグ 25 + アニメ 10×4）、Gemini 画像 1 枚（約 $0.04）
