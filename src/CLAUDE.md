# src/

アプリケーションのソースコード。

## ディレクトリ構成

```
src/
├── api/       # REST API 層 (コントローラー、スキーマ)
├── config/    # 設定ファイルのローダーとスキーマ定義
├── infra/     # インフラ層 (RTMP サーバー)
├── services/  # ビジネスロジック層
├── types/     # 型定義
├── utils/     # ユーティリティ
├── app.ts     # Express アプリケーション初期化
└── server.ts  # エントリポイント
```

## エントリポイント

- `server.ts` - サーバー起動処理。`createApp()` を呼び出して Express アプリを構築
- `app.ts` - Express アプリケーションの組み立て。ルーター登録、ミドルウェア設定、サービス初期化

## アーキテクチャ

```
[API Layer] → [Services Layer] → [Infra Layer]
     ↓              ↓
 [Config]       [Utils]
```

- **API層**: HTTP リクエスト/レスポンス処理
- **Services層**: ビジネスロジック（動画生成、TTS、キャッシュ）
- **Infra層**: 外部システム連携（RTMPサーバー）
