# src/infra/

インフラストラクチャ層。外部システムとの連携を担当。

## ファイル構成

| ファイル | 説明 |
|---------|------|
| `rtmp-server.ts` | RTMP サーバー管理 |

## rtmp-server.ts

`node-media-server` を使用した RTMP サーバーの起動・管理。

- ストリーミング配信時に使用
- 生成した動画を RTMP で配信可能
- 設定は `config.rtmp.outputUrl` で指定
