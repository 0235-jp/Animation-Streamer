# scripts

リップシンク用の前処理Pythonスクリプト群です。

## セットアップ

```bash
cd scripts

# 仮想環境を作成
python -m venv venv
source venv/bin/activate  # Linux/macOS
# venv\Scripts\activate   # Windows

# 依存パッケージをインストール
pip install -r requirements.txt
```

## preprocess_lipsync.py (推奨)

**口位置検出と口消し動画生成を一括で行うメインスクリプト。**

MotionPNGTuber同等のホモグラフィ変換・平面フィッティング陰影補正を実装。

### 機能

- **口位置検出**: mediapipe FaceLandmarkerで口の中心座標・サイズ・回転角度を抽出
- **口消し動画生成**: ホモグラフィ変換 + cv2.inpaint + 平面フィッティング陰影補正
- **自動参照フレーム選択**: 口が閉じていて品質の高いフレームを自動選択
- **フェザリング**: 境界を滑らかにブレンド

### 使い方

```bash
# 基本的な使い方（JSON + 口消し動画を出力）
python preprocess_lipsync.py input.mp4

# 出力プレフィックスを指定
python preprocess_lipsync.py input.mp4 -o output_prefix
# → output_prefix.mouth.json, output_prefix_mouthless.mp4

# デバッグ動画を出力（検出結果を可視化）
python preprocess_lipsync.py input.mp4 --debug-output debug.mp4

# 口消し領域を調整（0.0-1.0, デフォルト: 0.6）
python preprocess_lipsync.py input.mp4 --coverage 0.7
```

### 出力ファイル

| ファイル | 説明 |
|---------|------|
| `<入力>.mouth.json` | 口位置データ（TypeScript `MouthPositionData` 型準拠） |
| `<入力>_mouthless.mp4` | 口を消した動画（lipSync用ベース動画） |

### オプション

| オプション | デフォルト | 説明 |
|-----------|----------|------|
| `-o, --output` | `<入力ファイル名>` | 出力プレフィックス |
| `--stride` | 1 | フレームスキップ間隔（高速化用） |
| `--pad` | 0.3 | 口周辺のパディング係数 |
| `--smooth-cutoff` | 3.0 | 平滑化カットオフ周波数 (Hz)、0で無効 |
| `--coverage` | 0.6 | 口消し領域のカバレッジ (0.0-1.0) |
| `--inpaint-radius` | 5 | インペインティング半径 |
| `--min-detection-confidence` | 0.5 | 顔検出の最小信頼度 |
| `--min-tracking-confidence` | 0.5 | 顔トラッキングの最小信頼度 |
| `--debug-output` | - | デバッグ動画の出力パス |

### 処理フロー

1. **パス1**: 全フレームで口位置を検出、補間・平滑化
2. **パス2**: 最適な参照フレームを選択し、口消し処理を適用
   - ホモグラフィ変換で正規化空間にワープ
   - cv2.inpaint で口領域を埋める
   - 平面フィッティングで陰影を補正
   - フェザリングで境界をブレンド

---

## detect_mouth_positions.py

口位置検出のみを行うシンプルなスクリプト（口消しなし）。

```bash
python detect_mouth_positions.py input.mp4 -o output.json
```

---

## 出力JSON形式

TypeScriptの `MouthPositionData` 型（`src/services/lip-sync/types.ts`）に準拠。

```json
{
  "videoFileName": "input.mp4",
  "videoWidth": 1920,
  "videoHeight": 1080,
  "frameRate": 30.0,
  "totalFrames": 300,
  "durationSeconds": 10.0,
  "positions": [
    {
      "frameIndex": 0,
      "timeSeconds": 0.0,
      "centerX": 960.0,
      "centerY": 540.0,
      "width": 100.0,
      "height": 50.0,
      "confidence": 1.0,
      "rotation": 2.5
    }
  ],
  "createdAt": "2024-01-01T00:00:00+00:00"
}
```

**フィールド説明:**
- `centerX`, `centerY`: 口の中心座標（ピクセル）
- `width`, `height`: 口のサイズ（ピクセル）
- `rotation`: 顔の回転角度（度数法、正=時計回り）
- `confidence`: 検出信頼度（1.0=検出成功, 0.5=補間, 0.3=外挿）

---

## ワークフロー

### lipSync用の素材準備

```bash
# 1. ループ動画を前処理
python preprocess_lipsync.py loop.mp4

# 2. 出力ファイルをmotions/に配置
#    - loop.mouth.json → motions/loop.mouth.json
#    - loop_mouthless.mp4 → motions/loop_mouthless.mp4

# 3. config/stream-profile.json を設定
```

```json
{
  "lipSync": {
    "large": [
      {
        "id": "lip-neutral",
        "emotion": "neutral",
        "basePath": "loop_mouthless.mp4",
        "mouthDataPath": "loop.mouth.json",
        "images": {
          "A": "lip/open.png",
          "I": "lip/half.png",
          ...
        }
      }
    ]
  }
}
```

---

## ディレクトリ構造

```
scripts/
├── preprocess_lipsync.py     # メインスクリプト（口位置検出 + 口消し）
├── detect_mouth_positions.py # 口位置検出のみ
├── requirements.txt          # Python依存パッケージ
├── models/                   # モデルファイル（自動生成）
│   └── face_landmarker.task
├── CLAUDE.md                 # Claude Code用ドキュメント
└── README.md                 # このファイル
```

---

## 動作環境

- Python 3.10+
- mediapipe >= 0.10.0
- opencv-python >= 4.8.0
- numpy >= 1.24.0

## 注意事項

- **実写向けモデル**: mediapipe は実写の顔に最適化されています。アニメキャラクターでは検出精度が低下する場合があります。
- **初回実行時**: モデルファイル (`face_landmarker.task`) を `models/` ディレクトリに自動ダウンロードします (~4MB)。
