# Animation Streamer – 概要設計書

## 目的
- ローカル環境で待機モーション動画を常時ストリームし、OBSなどの配信ツールから取得してYouTube等へ中継できるようにする。
- テキスト入力に応じて音声を生成し、音声と発話用モーション動画を組み合わせて待機ストリームへ差し込むための土台を用意する。
- 動画・音声素材やTTS設定をJSONで柔軟に管理し、あとからモーションを増やしやすくする（一人キャラクター想定のため音声プロファイルは1件固定）。

## スコープ
- `start`/`stop` エンドポイントを備えたNode.jsベースのローカルサーバー。
- RTMP/HTTP-FLV配信を提供しOBSのメディアソースとして利用可能にする。
- 待機モーションを複数登録し、各クリップ再生終了ごとにランダム切り替えでループ再生する仕組み。
- `text` エンドポイントのインタフェースを先行定義（内部処理はTODO）。

## 技術選定
- **ランタイム**: Node.js (TypeScript)。
- **Webフレームワーク**: Express。シンプルなREST APIとDI構造が取りやすい。
- **配信サーバー**: node-media-server（RTMP/HTTP-FLV）。OBSから `rtmp://localhost:1935/live/main` を参照。
- **メディア制御**: ffmpeg + fluent-ffmpeg ラッパー。映像ループや音声ミックスをシェルプロセスとして管理。
- **設定**: `config/stream-profile.json` を起動時に読み込み。待機モーション複数＋単一音声プロファイル（VOICEVOXのURLやSpeaker ID含む）を定義し、ホットリロードは不要。
- **状態管理**: アプリ内の `StreamSession` が現在の状態・実行中プロセス・キューを集中管理。

## 全体アーキテクチャ
```
Client (OBS, API caller)
        |
   Express API (REST)  -- status/start/stop/text
        |
   StreamService (State machine & orchestration)
   |          \
WaitingLoop   SpeechTaskQueue (TODO)
Controller     \
               MediaPipeline (ffmpeg, TTS, assets)
        |
 node-media-server (RTMP)
        |
 OBS -> YouTube Live
```

## 主なコンポーネント
- **Express API 層**: 認証(ローカルAPIキー想定)、入力バリデーション、`StreamService` 呼び出し。
- **StreamService / StreamSession**: 状態遷移 (IDLE, WAITING, SPEECH, STOPPED) とプロセスハンドルを保持。待機ループの開始・停止、タスクキューへの操作口を提供。
- **WaitingLoopController**: 複数の待機モーションを管理。1つのffmpegプロセスに`concat`デマルチプレクサでプレイリストを流し込み、各動画の終了直前に次モーションをランダム選択して書き込むことでフレーム落ちなく切り替える。発話モーションも同じプレイリストに割り込み挿入し、待機→発話→待機の継ぎ目でフレームギャップを生まない。
- **SpeechTaskQueue (将来実装)**: `text` APIから受けたタスクを受信順でFIFO管理。生成完了が前後しても再生順は保証する。
- **MediaPipeline**: ffmpegプロセスの生成/監視と、VOICEVOXなどのTTSとの橋渡し。音声と動画の合成、一時ファイルの管理を担当。
- **ConfigLoader**: JSONを読み込み、型チェック済みの設定オブジェクトをDIコンテナへ供給。

## リクエストフロー（start/stop）
1. **POST /api/start**
   - 状態がIDLE/STOPPEDなら待機ループを開始。
   - `WaitingLoopController` がffmpeg(`concat`入力)を起動し、最初の待機モーションをプレイリストに流し込む。
   - レスポンスは現在の状態と使用中のモーションIDを返却。
2. **POST /api/stop**
   - 進行中の待機ループと（将来的に）音声タスクを停止し、ffmpeg子プロセスを終了。
   - 一時ファイルなどをクリーンアップし、状態をSTOPPEDへ。

## 状態遷移
```
IDLE --start--> WAITING --text--> SPEECH --(speech done)--> WAITING
WAITING --stop--> STOPPED
SPEECH --stop--> STOPPED
STOPPED --start--> WAITING
```

## 将来拡張の指針
- `text` エンドポイント：TTS連携、音声と発話モーションの合成、待機への復帰を順次処理する。
- 配信形式：node-media-serverでHLS/LL-HLSを有効化し、OBS以外のクライアントへの配信も可能にする。
- 設定テンプレ：モーションカテゴリ、音声プロファイル、TTSエンジン別設定の追加。
