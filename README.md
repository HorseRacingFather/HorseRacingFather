# HorseRacingFather

JRA のレース情報を収集し、予想（ChatGPT）をマージして表示する静的サイト。GitHub Pages 自動デプロイと、金曜夜(JST)のデータ・予想自動更新に対応。

## 必要環境

- Node.js 20 系
- Python 3.11 以上
- （予想生成に必要）OpenAI API キー: 環境変数 `OPENAI_API_KEY`
  - モデルは `OPENAI_MODEL`（省略時は `gpt-4o-mini`）

## ローカル実行（データ取得→予想生成→起動）

```bash
cd web
npm ci

# 1) 週間データ生成（出力先: /web/public/data/YYYY/... および /web/public/data/current.json）
npm run gen:data

# 2) 予想生成（ChatGPT を使用）
#   - OPENAI_API_KEY を設定して実行
#   - 入力は public/data/current.json、出力は public/data/{week}.json と current.json（マージ済み）
export OPENAI_API_KEY=sk-xxxx
python3 scripts/predict.py public/data/current.json public/data

# 3) dev サーバで表示
#   - /web/public 配下がルートに配信されます
npm run dev
```

ブラウザ: `http://localhost:5173/HorseRacingFather/`（`base` 未設定なら `/`）

## 予想スクリプト詳細（Python）

- スクリプト: `web/scripts/predict.py`
- 入力: 週次 JSON（例: `web/public/data/2025/2025-09-20.json` または `web/public/data/current.json`）
- 処理:
  - 各エントリの `horseDbUrl` にアクセスし、直近成績の簡易情報を抽出
  - レース・馬の情報をプロンプトへ整形し、ChatGPT へ問い合わせ
  - 応答 JSON（`{ horseId: 0〜1の確率 }`）を正規化（合計 = 1.0）
  - `web/public/predictions/{week}.json` と `web/public/predictions/current.json` を出力
- 環境変数:
  - `OPENAI_API_KEY`（必須）
  - `OPENAI_MODEL`（任意、デフォルト `gpt-4o-mini`）

例:

```bash
cd web
export OPENAI_API_KEY=sk-xxxx
python3 scripts/predict_mock.py data/2025/2025-09-20.json
```

## フロントエンドの挙動

- データ本体: `/data/{yyyy}/{week}.json` or `/data/current.json` を取得
- 予想: `/predictions/current.json` → なければ `/predictions/{week}.json`
- 取得した予想を `raceId -> horseId -> score` として `predictionScore` にマージして表示

## ビルド

```bash
cd web
npm run build
```

`web/dist` が生成されます（Pages へデプロイされます）。

## GitHub Actions（自動更新）

- ワークフロー: `.github/workflows/generate-and-predict.yml`
- スケジュール: 毎週金曜 12:00 UTC（JST 21:00 目安）
- 手動実行: `workflow_dispatch` から実行可能（入力 `week_json` は任意）
- していること:
  1. Node セットアップ → `npm ci` → 週間データ生成
  2. Python セットアップ → 予想生成（ChatGPT 使用、マージ済み JSON を `web/public/data` に出力）
  3. `web/public/data` をコミット・プッシュ
- Secrets に以下を設定してください:
  - `OPENAI_API_KEY`

## 参考リンク

- netkeiba カレンダー: [https://race.netkeiba.com/top/calendar.html](https://race.netkeiba.com/top/calendar.html)