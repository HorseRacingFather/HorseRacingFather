# Web App 開発ガイド

## セットアップと開発

```bash
npm ci

# 週間データ生成（出力先: public/data/... と public/data/current.json）
npm run gen:data

# 予想生成＆マージ済みJSONを書き出し（出力先: public/data）
export OPENAI_API_KEY=sk-xxxx
python3 scripts/predict.py public/data/current.json public/data

# 開発サーバ
npm run dev
```

## データの読み込み（フロント）

- フロントは単一の JSON を読み込みます。
- 取得先の優先度: `/data/current.json` → `/data/{yyyy}/{week}.json`（自動判定）。

## 予想ファイルの生成（Python）

`scripts/predict.py` は週次 JSON を入力に、各馬の勝率を `predictionScore` としてマージ済みの JSON を `public/data` に出力します。

```bash
export OPENAI_API_KEY=sk-xxxx
python3 scripts/predict.py public/data/current.json public/data
```

詳細はリポジトリ直下の `README.md` を参照してください。
