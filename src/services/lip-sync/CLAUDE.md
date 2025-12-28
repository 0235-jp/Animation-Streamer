# src/services/lip-sync/

リップシンク機能モジュール。音声に同期した口の動きを動画として生成する。

## ファイル構成

| ファイル | 説明 |
|---------|------|
| `index.ts` | モジュールエクスポート |
| `types.ts` | 型定義 (MouthPosition, MouthPositionData, VisemeSegment など) |
| `timeline-generator.ts` | VOICEVOX モーラ情報からビゼムタイムライン生成 |
| `mfcc-provider.ts` | MFCC 音声解析によるタイムライン生成 |
| `overlay-composer.ts` | FFmpeg オーバーレイ合成（回転対応） |
| `profile.json` | MFCC キャリブレーションデータ |

## 処理フロー

```text
音声入力
    │
    ├─ VOICEVOX ─────────────────┐
    │   audio_query → モーラ情報  │
    │         │                  │
    │         ▼                  │
    │   generateVisemeTimeline() │
    │                            │
    ├─ SBV2 / 直接音声 ──────────┤
    │   MFCC解析                 │
    │         │                  │
    │         ▼                  │
    │   MfccProvider.generate()  │
    │                            │
    └────────────┬───────────────┘
                 ▼
         VisemeSegment[]
                 │
                 ▼
    composeOverlayLipSyncVideo()
    (ベース動画 + 口画像オーバーレイ)
                 │
                 ▼
            出力MP4
```

## ビゼム形状 (aiueoN)

| 形状 | 説明 |
|-----|------|
| A | あ - 大きく開いた口 |
| I | い - 横に広がった口 |
| U | う - すぼめた口 |
| E | え - 中間的に開いた口 |
| O | お - 丸く開いた口 |
| N | ん/無音 - 閉じた口 |

## オーバーレイ合成

`overlay-composer.ts` は以下の処理を行う:

1. 口位置JSON（Python事前処理で生成）を読み込み
2. ベース動画を音声長にループ
3. 各ビゼムセグメントに対応する口画像をオーバーレイ
4. FFmpeg の `overlay` フィルタで時間条件付き合成
5. 音声トラックを多重化

## 事前処理（Python）

ベース動画からの口位置検出は `scripts/preprocess_lipsync.py`（推奨）で行う。
出力ファイル:
- `<入力>.mouth.json`: 口位置データ（`mouthDataPath` で参照）
- `<入力>_mouthless.mp4`: 口消し済み動画（`basePath` で参照）

`MouthPosition` には `rotation` フィールド（顔の回転角度）が含まれ、オーバーレイ合成時に口画像が回転される。
