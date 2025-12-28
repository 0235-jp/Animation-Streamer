#!/usr/bin/env python3
"""
動画から口位置を検出してJSONファイルに出力するスクリプト

mediapipe FaceLandmarker (Tasks API) を使用して顔の口領域を検出し、
各フレームの口の中心座標・サイズを抽出する。
Zero-phase平滑化で振動を抑制し、JSON形式で出力する。

使用例:
    python detect_mouth_positions.py input.mp4 -o output.json
    python detect_mouth_positions.py input.mp4 --smooth-cutoff 3.0 --stride 1
"""

import argparse
import json
import math
import sys
import urllib.request
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

try:
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision
except ImportError:
    print("Error: mediapipe がインストールされていません")
    print("  pip install mediapipe opencv-python numpy")
    sys.exit(1)


# モデルファイルのURL
MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task"
MODEL_FILENAME = "face_landmarker.task"

# mediapipe FaceLandmarker の口関連ランドマークインデックス (478点中)
# 外側の唇輪郭
MOUTH_OUTER_INDICES = [
    61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291,
    409, 270, 269, 267, 0, 37, 39, 40, 185
]
# 口の端点
MOUTH_LEFT = 61
MOUTH_RIGHT = 291
MOUTH_TOP = 13
MOUTH_BOTTOM = 14

# 目のランドマーク（回転角度計算用）
LEFT_EYE_OUTER = 33
RIGHT_EYE_OUTER = 263


def download_model(model_dir: Path) -> Path:
    """モデルファイルをダウンロード"""
    model_path = model_dir / MODEL_FILENAME
    if model_path.exists():
        return model_path

    print(f"モデルをダウンロード中: {MODEL_URL}")
    model_dir.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(MODEL_URL, model_path)
    print(f"モデルを保存しました: {model_path}")
    return model_path


def one_pole_beta(cutoff_hz: float, fps: float) -> float:
    """EMAフィルタの係数を計算"""
    if cutoff_hz <= 0 or fps <= 0:
        return 0.0
    rc = 1.0 / (2.0 * np.pi * cutoff_hz)
    dt = 1.0 / fps
    return dt / (rc + dt)


def smooth_positions_zero_phase(
    positions: list[dict],
    fps: float,
    cutoff_hz: float = 3.0,
) -> list[dict]:
    """
    Zero-phase EMA平滑化を適用

    前方向と後方向にEMAフィルタを適用することで、遅延なしの平滑化を実現
    """
    if len(positions) < 2 or cutoff_hz <= 0:
        return positions

    beta = one_pole_beta(cutoff_hz, fps)
    if beta <= 0 or beta >= 1:
        return positions

    # 有効なフレームのインデックスを取得
    valid_indices = [i for i, p in enumerate(positions) if p["confidence"] > 0]
    if len(valid_indices) < 2:
        return positions

    # 平滑化対象のキー
    keys = ["centerX", "centerY", "width", "height", "rotation"]

    # 各キーに対して平滑化
    smoothed = [p.copy() for p in positions]

    for key in keys:
        # 有効な値を抽出
        values = np.array([positions[i][key] for i in valid_indices], dtype=np.float64)

        # 前方向フィルタ
        forward = np.zeros_like(values)
        forward[0] = values[0]
        for i in range(1, len(values)):
            forward[i] = beta * values[i] + (1 - beta) * forward[i - 1]

        # 後方向フィルタ
        backward = np.zeros_like(values)
        backward[-1] = forward[-1]
        for i in range(len(values) - 2, -1, -1):
            backward[i] = beta * forward[i] + (1 - beta) * backward[i + 1]

        # 結果を適用
        for j, idx in enumerate(valid_indices):
            smoothed[idx][key] = float(backward[j])

    return smoothed


def interpolate_invalid_positions(positions: list[dict]) -> list[dict]:
    """
    検出失敗フレームを線形補間で埋める
    """
    if not positions:
        return positions

    result = [p.copy() for p in positions]
    valid_indices = [i for i, p in enumerate(positions) if p["confidence"] > 0]

    if len(valid_indices) == 0:
        return result

    keys = ["centerX", "centerY", "width", "height", "rotation"]

    for i, pos in enumerate(result):
        if pos["confidence"] > 0:
            continue

        # 前後の有効フレームを探す
        prev_idx = None
        next_idx = None

        for vi in valid_indices:
            if vi < i:
                prev_idx = vi
            elif vi > i and next_idx is None:
                next_idx = vi
                break

        if prev_idx is not None and next_idx is not None:
            # 線形補間
            t = (i - prev_idx) / (next_idx - prev_idx)
            for key in keys:
                v0 = positions[prev_idx][key]
                v1 = positions[next_idx][key]
                result[i][key] = v0 + t * (v1 - v0)
            result[i]["confidence"] = 0.5  # 補間値
        elif prev_idx is not None:
            # 前の値をコピー
            for key in keys:
                result[i][key] = positions[prev_idx][key]
            result[i]["confidence"] = 0.3
        elif next_idx is not None:
            # 次の値をコピー
            for key in keys:
                result[i][key] = positions[next_idx][key]
            result[i]["confidence"] = 0.3

    return result


def calculate_face_rotation(
    landmarks: list,
    frame_width: int,
    frame_height: int,
) -> float:
    """
    目のランドマークから顔の回転角度を計算

    Returns:
        回転角度（度数法）。正の値は時計回り。
    """
    left_eye = landmarks[LEFT_EYE_OUTER]
    right_eye = landmarks[RIGHT_EYE_OUTER]

    # ピクセル座標に変換
    dx = (right_eye.x - left_eye.x) * frame_width
    dy = (right_eye.y - left_eye.y) * frame_height

    # 角度を計算（水平からの傾き）
    angle = math.degrees(math.atan2(dy, dx))

    return angle


def extract_mouth_from_landmarks(
    landmarks: list,
    frame_width: int,
    frame_height: int,
    pad: float = 0.3,
) -> Optional[dict]:
    """
    mediapipe FaceLandmarker のランドマークから口の位置・サイズ・回転を抽出
    """
    # 口の外側ランドマークを取得
    mouth_points = []
    for idx in MOUTH_OUTER_INDICES:
        lm = landmarks[idx]
        x = lm.x * frame_width
        y = lm.y * frame_height
        mouth_points.append((x, y))

    mouth_points = np.array(mouth_points)

    # 口の中心
    center_x = float(np.mean(mouth_points[:, 0]))
    center_y = float(np.mean(mouth_points[:, 1]))

    # 口の幅と高さ（端点から計算）
    left = landmarks[MOUTH_LEFT]
    right = landmarks[MOUTH_RIGHT]
    top = landmarks[MOUTH_TOP]
    bottom = landmarks[MOUTH_BOTTOM]

    width = abs(right.x - left.x) * frame_width
    height = abs(bottom.y - top.y) * frame_height

    # パディング追加
    width = width * (1 + pad)
    height = height * (1 + pad)

    # 最小サイズを保証
    min_width = frame_width * 0.05
    min_height = frame_height * 0.03
    width = max(width, min_width)
    height = max(height, min_height)

    # 回転角度を計算
    rotation = calculate_face_rotation(landmarks, frame_width, frame_height)

    return {
        "centerX": center_x,
        "centerY": center_y,
        "width": width,
        "height": height,
        "rotation": rotation,
    }


def detect_mouth_positions(
    video_path: str,
    stride: int = 1,
    pad: float = 0.3,
    smooth_cutoff: float = 3.0,
    min_detection_confidence: float = 0.5,
    min_tracking_confidence: float = 0.5,
    debug_output: Optional[str] = None,
) -> dict:
    """
    動画から口位置を検出

    Args:
        video_path: 入力動画パス
        stride: フレームスキップ間隔（1=全フレーム処理）
        pad: 口周辺のパディング係数
        smooth_cutoff: 平滑化のカットオフ周波数 (Hz)
        min_detection_confidence: 顔検出の最小信頼度
        min_tracking_confidence: 顔トラッキングの最小信頼度
        debug_output: デバッグ動画の出力パス

    Returns:
        MouthPositionData形式の辞書
    """
    # モデルをダウンロード
    script_dir = Path(__file__).parent
    model_path = download_model(script_dir / "models")

    # 動画を開く
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"動画を開けません: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    print(f"動画情報: {width}x{height} @ {fps:.2f}fps, {total_frames}フレーム")

    # FaceLandmarker を初期化
    base_options = mp_python.BaseOptions(model_asset_path=str(model_path))
    options = vision.FaceLandmarkerOptions(
        base_options=base_options,
        running_mode=vision.RunningMode.VIDEO,
        num_faces=1,
        min_face_detection_confidence=min_detection_confidence,
        min_tracking_confidence=min_tracking_confidence,
        output_face_blendshapes=False,
        output_facial_transformation_matrixes=False,
    )
    landmarker = vision.FaceLandmarker.create_from_options(options)
    print("mediapipe FaceLandmarker を初期化しました")

    # デバッグ出力の準備
    debug_writer = None
    if debug_output:
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        debug_writer = cv2.VideoWriter(debug_output, fourcc, fps, (width, height))

    # 各フレームを処理
    positions = []
    frame_idx = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        time_seconds = frame_idx / fps
        timestamp_ms = int(frame_idx * 1000 / fps)

        # 初期値（検出失敗時）
        position = {
            "frameIndex": frame_idx,
            "timeSeconds": round(time_seconds, 4),
            "centerX": width / 2,
            "centerY": height * 0.7,
            "width": width * 0.2,
            "height": height * 0.1,
            "confidence": 0.0,
            "rotation": 0.0,
        }

        # strideに基づいて検出を実行
        if frame_idx % stride == 0:
            # BGR -> RGB
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)

            # 顔検出
            result = landmarker.detect_for_video(mp_image, timestamp_ms)

            if result.face_landmarks and len(result.face_landmarks) > 0:
                face_landmarks = result.face_landmarks[0]

                # 口の位置を抽出
                mouth = extract_mouth_from_landmarks(
                    face_landmarks, width, height, pad
                )

                if mouth:
                    position.update(mouth)
                    position["confidence"] = 1.0

                    # デバッグ描画
                    if debug_writer:
                        cx, cy = int(mouth["centerX"]), int(mouth["centerY"])
                        w, h = int(mouth["width"]), int(mouth["height"])
                        x1, y1 = cx - w // 2, cy - h // 2
                        x2, y2 = cx + w // 2, cy + h // 2
                        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
                        cv2.circle(frame, (cx, cy), 3, (0, 0, 255), -1)

                        # 口のランドマークを描画
                        for idx in MOUTH_OUTER_INDICES:
                            lm = face_landmarks[idx]
                            px = int(lm.x * width)
                            py = int(lm.y * height)
                            cv2.circle(frame, (px, py), 1, (255, 0, 0), -1)

        positions.append(position)

        if debug_writer:
            # フレーム情報を描画
            cv2.putText(
                frame,
                f"Frame: {frame_idx} Conf: {position['confidence']:.2f}",
                (10, 30),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                (255, 255, 255),
                2,
            )
            debug_writer.write(frame)

        frame_idx += 1

        # 進捗表示
        if frame_idx % 100 == 0:
            print(f"処理中: {frame_idx}/{total_frames} フレーム")

    cap.release()
    landmarker.close()
    if debug_writer:
        debug_writer.release()

    print(f"検出完了: {frame_idx} フレーム")

    # 検出成功率を計算
    valid_count = sum(1 for p in positions if p["confidence"] > 0)
    print(f"検出成功率: {valid_count}/{len(positions)} ({100*valid_count/len(positions):.1f}%)")

    # 無効フレームを補間
    positions = interpolate_invalid_positions(positions)

    # 平滑化
    if smooth_cutoff > 0:
        print(f"平滑化を適用 (cutoff={smooth_cutoff}Hz)")
        positions = smooth_positions_zero_phase(positions, fps, smooth_cutoff)

    # 出力用にpositionsから不要フィールドを削除
    output_positions = []
    for pos in positions:
        output_positions.append({
            "frameIndex": pos["frameIndex"],
            "centerX": pos["centerX"],
            "centerY": pos["centerY"],
            "width": pos["width"],
            "height": pos["height"],
            "rotation": pos["rotation"],
        })

    # 結果を構築
    result = {
        "videoWidth": width,
        "videoHeight": height,
        "frameRate": fps,
        "totalFrames": len(output_positions),
        "positions": output_positions,
    }

    return result


def main():
    parser = argparse.ArgumentParser(
        description="動画から口位置を検出してJSONに出力 (mediapipe版)"
    )
    parser.add_argument("video", help="入力動画ファイル")
    parser.add_argument(
        "-o", "--output",
        help="出力JSONファイル（デフォルト: 入力ファイル名.mouth.json）",
    )
    parser.add_argument(
        "--stride",
        type=int,
        default=1,
        help="フレームスキップ間隔（デフォルト: 1=全フレーム）",
    )
    parser.add_argument(
        "--pad",
        type=float,
        default=0.3,
        help="口周辺のパディング係数（デフォルト: 0.3）",
    )
    parser.add_argument(
        "--smooth-cutoff",
        type=float,
        default=3.0,
        help="平滑化カットオフ周波数 Hz（デフォルト: 3.0、0で無効）",
    )
    parser.add_argument(
        "--min-detection-confidence",
        type=float,
        default=0.5,
        help="顔検出の最小信頼度（デフォルト: 0.5）",
    )
    parser.add_argument(
        "--min-tracking-confidence",
        type=float,
        default=0.5,
        help="顔トラッキングの最小信頼度（デフォルト: 0.5）",
    )
    parser.add_argument(
        "--debug-output",
        help="デバッグ動画の出力パス",
    )

    args = parser.parse_args()

    video_path = Path(args.video)
    if not video_path.exists():
        print(f"エラー: 動画ファイルが見つかりません: {video_path}")
        sys.exit(1)

    # 出力パスを決定
    if args.output:
        output_path = Path(args.output)
    else:
        output_path = video_path.with_suffix(".mouth.json")

    print(f"入力: {video_path}")
    print(f"出力: {output_path}")

    # 検出実行
    result = detect_mouth_positions(
        str(video_path),
        stride=args.stride,
        pad=args.pad,
        smooth_cutoff=args.smooth_cutoff,
        min_detection_confidence=args.min_detection_confidence,
        min_tracking_confidence=args.min_tracking_confidence,
        debug_output=args.debug_output,
    )

    # JSON出力
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"完了: {output_path}")


if __name__ == "__main__":
    main()
