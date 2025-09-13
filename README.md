# HorseRacingFather

レースを取得し、簡易予想とともに表示する静的サイト。GitHub Pagesに自動デプロイ、金曜夜(JST)にデータ自動更新。

## セットアップ

```bash
cd web
npm ci
npm run gen:data
mkdir -p public/data && cp -R data public/
npm run dev
```

ブラウザで `http://localhost:5173/HorseRacingFather/`（または `base` 無しの場合は `/`）

## ビルド/デプロイ

```bash
cd web
npm run build
```

`main` に push で GitHub Actions が `web/dist` を `gh-pages` へデプロイします。

## 定期更新（データ収集）

- 金曜 21:00 JST（UTC 12:00）に `Weekly Data Fetch` ワークフローが `web/data` を更新しコミットします。

## 参考リンク

- netkeiba カレンダー: [https://race.netkeiba.com/top/calendar.html](https://race.netkeiba.com/top/calendar.html)