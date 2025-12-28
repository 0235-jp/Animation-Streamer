# scripts/

リップシンク用の前処理Pythonスクリプト群

## ファイル

### preprocess_lipsync.py（推奨）

口位置検出と口消し動画生成を一括で行うメインスクリプト。

**機能:**
- mediapipe FaceLandmarker で口の中心座標・サイズ・回転角度を抽出
- ホモグラフィ変換 + cv2.inpaint + 平面フィッティング陰影補正で口を消去
- 自動参照フレーム選択（口が閉じていて品質の高いフレーム）
- フェザリングで境界を滑らかにブレンド

**使用例:**
```bash
# 基本的な使い方（JSON + 口消し動画を出力）
python preprocess_lipsync.py input.mp4

# 出力プレフィックスを指定
python preprocess_lipsync.py input.mp4 -o output_prefix

# デバッグ動画を出力
python preprocess_lipsync.py input.mp4 --debug-output debug.mp4
```

**出力ファイル:**
- `<入力>.mouth.json`: 口位置データ（TypeScript `MouthPositionData` 型準拠）
- `<入力>_mouthless.mp4`: 口を消した動画（lipSync用ベース動画）

**主要オプション:**
- `-o, --output`: 出力プレフィックス
- `--stride`: フレームスキップ間隔（高速化用、デフォルト: 1）
- `--pad`: 口周辺のパディング係数（デフォルト: 0.3）
- `--smooth-cutoff`: 平滑化カットオフ周波数 Hz（デフォルト: 3.0、0で無効）
- `--coverage`: 口消し領域のカバレッジ 0.0-1.0（デフォルト: 0.6）
- `--inpaint-radius`: インペインティング半径（デフォルト: 5）
- `--debug-output`: デバッグ動画の出力パス

### detect_mouth_positions.py

口位置検出のみを行うシンプルなスクリプト（口消しなし）。

**使用例:**
```bash
python detect_mouth_positions.py input.mp4 -o output.json
```

**出力フィールド:**
- `centerX`, `centerY`: 口の中心座標（ピクセル）
- `width`, `height`: 口のサイズ（ピクセル）
- `rotation`: 顔の回転角度（度数法、正=時計回り）

### calibrate_mouth_positions.py

検出した口位置をインタラクティブに調整するキャリブレーションツール。

**使用例:**
```bash
python calibrate_mouth_positions.py input.mp4 input.mouth.json
```

**操作方法:**
- マウス左ドラッグ: 位置調整
- マウスホイール: サイズ調整
- 矢印キー: 位置微調整 (1px)
- `+`/`-`: サイズ調整
- `R`: リセット、`S`: 保存、`Q`/`ESC`: 終了
- `Space`: 再生/停止、`,`/`.`: 前/次のフレーム

### convert_npz_to_json.py

MotionPNGTuber の `mouth_track.npz` を本プロジェクトの JSON 形式に変換するスクリプト。

**使用例:**
```bash
python convert_npz_to_json.py mouth_track.npz -o output.mouth.json
```

**オプション:**
- `-o, --output`: 出力JSONファイル（デフォルト: 入力ファイル名.mouth.json）

**変換内容:**
- `quad` (4頂点座標) → `centerX`, `centerY`, `width`, `height`, `rotation`
- `det_stride` > 1 の場合、中間フレームを線形補間

## lipSync用の素材準備ワークフロー

```bash
# 1. ループ動画を前処理
python preprocess_lipsync.py loop.mp4

# 2. 出力ファイルをmotions/に配置
#    - loop.mouth.json → motions/loop.mouth.json
#    - loop_mouthless.mp4 → motions/loop_mouthless.mp4

# 3. config/stream-profile.json を設定
```

**config設定例:**
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
          "U": "lip/small.png",
          "E": "lip/mid.png",
          "O": "lip/round.png",
          "N": "lip/closed.png"
        }
      }
    ]
  }
}
```

## セットアップ

```bash
cd scripts
python -m venv venv
source venv/bin/activate  # Linux/macOS
pip install -r requirements.txt
```

## 依存関係

- Python 3.10+
- mediapipe >= 0.10.20
- opencv-python >= 4.10.0
- numpy >= 2.2.0

## MotionPNGTuber連携

アニメキャラクターなど mediapipe で検出しにくい素材には [MotionPNGTuber](https://github.com/rotejin/MotionPNGTuber) を使用可能。

1. MotionPNGTuber で顔トラッキング → `mouth_track.npz`
2. MotionPNGTuber で口消し動画生成 → `loop_mouthless.mp4`
3. `convert_npz_to_json.py` で変換 → `loop.mouth.json`

詳細は README.md の「MotionPNGTuberとの連携」セクションを参照。

## 注意事項

- mediapipe は実写の顔に最適化されているため、アニメキャラクターでは検出精度が低下する場合がある（→ MotionPNGTuber の使用を推奨）
- 初回実行時にモデルファイル (`face_landmarker.task`) を自動ダウンロード (~4MB)
