# src/types/

TypeScript 型定義。

## ファイル構成

| ファイル | 説明 |
|---------|------|
| `generate.ts` | 動画生成関連の型定義 |
| `node-media-server.d.ts` | node-media-server の型宣言 |

## generate.ts

主要な型:
- `GenerateRequestPayload` - 生成リクエスト全体
- `GenerateRequestItem` - 個別アクション (start/speak/idle)
- `ActionResult` - アクション処理結果
- `AudioInput` - 音声入力 (text/audio)
- `StreamPushHandler` - ストリーミング用コールバック

## node-media-server.d.ts

`node-media-server` パッケージの型宣言（型定義がないため）。
