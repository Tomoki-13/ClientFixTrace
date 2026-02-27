# LibraryTrace
## index.ts にデータセットのファイルをセット
## ユーザを分析する
```sh
cd src
ts-node index.ts
```
※ state はtest.jsonから読み込む結果の状態

## サブツール
### バージョン移行データをupdate,downgrade等に分けたい場合
```sh
cd src/subtool
ts-node sortResults.ts
```

### ライブラリの特定バージョンを基準に、クライアントのバージョン移行状況を抽出するためのフィルタリングツール
クライアントごとのバージョン履歴データ(/output/versionData/日時)を読み込み指定バージョン以上に更新されたクライアントを抽出
特定バージョンへ更新した際のコミット情報を別途出力


## 結果の格納場所
/output/versionData/ : クライアントの実際のバージョン遷移を出力
