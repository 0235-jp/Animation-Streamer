# example/

サンプル素材とクライアント実装を格納するディレクトリ。

## ディレクトリ構成

```
example/
├── client/    # TypeScript クライアントライブラリ例
├── motions/   # サンプルモーション動画素材
└── voice/     # サンプル音声ファイル
```

## client/

Animation Streamer API を呼び出す TypeScript クライアントの実装例。
- 独自の package.json を持つ独立したプロジェクト
- WebSocket と REST API の両方に対応

## motions/

サンプルモーション動画素材（MP4）。
- セットアップ時に `motions/` ディレクトリにコピーして使用
- `cp example/motions/* motions/`

## voice/

サンプル音声ファイル。STT テスト用途。
