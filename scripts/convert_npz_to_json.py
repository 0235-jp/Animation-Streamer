#!/usr/bin/env python3
"""
MotionPNGTuber の mouth_track.npz を MouthPositionData 形式の JSON に変換するスクリプト

MotionPNGTuber (https://github.com/rotejin/MotionPNGTuber) で生成された
口トラッキングデータ (.npz) を、本プロジェクトの lipSync 機能で使用できる
JSON 形式に変換する。

使用例:
    python convert_npz_to_json.py mouth_track.npz -o output.mouth.json
"""

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np


def load_npz(npz_path: str) -> dict:
    """
    mouth_track.npz ファイルを読み込む

    Args:
        npz_path: npzファイルのパス

    Returns:
        npzファイルの内容を辞書として返す
    """
    data = np.load(npz_path)

    result = {}
    for key in data.files:
        value = data[key]
        # スカラー値の場合は item() で Python の型に変換
        if value.ndim == 0:
            result[key] = value.item()
        else:
            result[key] = value

    return result


def quad_to_mouth_position(
    quad: np.ndarray,
    frame_index: int,
) -> dict:
    """
    quad（4頂点座標）から MouthPosition 形式に変換

    quad の頂点順序: [左上, 右上, 右下, 左下] を想定

    Args:
        quad: shape (4, 2) の座標配列
        frame_index: フレーム番号

    Returns:
        MouthPosition 形式の辞書
    """
    # 中心座標: 4頂点の重心
    center_x = float(np.mean(quad[:, 0]))
    center_y = float(np.mean(quad[:, 1]))

    # 幅: 上辺と下辺の平均
    top_width = np.linalg.norm(quad[1] - quad[0])
    bottom_width = np.linalg.norm(quad[2] - quad[3])
    width = float((top_width + bottom_width) / 2)

    # 高さ: 左辺と右辺の平均
    left_height = np.linalg.norm(quad[3] - quad[0])
    right_height = np.linalg.norm(quad[2] - quad[1])
    height = float((left_height + right_height) / 2)

    # 回転角度: 上辺の傾きから計算
    dx = quad[1, 0] - quad[0, 0]
    dy = quad[1, 1] - quad[0, 1]
    rotation = float(math.degrees(math.atan2(dy, dx)))

    return {
        "frameIndex": frame_index,
        "centerX": round(center_x, 2),
        "centerY": round(center_y, 2),
        "width": round(width, 2),
        "height": round(height, 2),
        "rotation": round(rotation, 2),
    }


def convert_npz_to_json(npz_path: str) -> dict:
    """
    npz ファイルを MouthPositionData 形式に変換

    Args:
        npz_path: 入力 npz ファイルパス

    Returns:
        MouthPositionData 形式の辞書
    """
    data = load_npz(npz_path)

    # 必須フィールドの確認
    required_fields = ["quad", "fps", "w", "h"]
    for field in required_fields:
        if field not in data:
            raise ValueError(f"npz ファイルに必須フィールド '{field}' がありません")

    quads = data["quad"]  # (N, 4, 2)
    fps = float(data["fps"])
    width = int(data["w"])
    height = int(data["h"])

    total_frames = len(quads)

    # det_stride がある場合、実際のフレーム数を計算
    det_stride = int(data.get("det_stride", 1))

    print(f"入力: {npz_path}")
    print(f"動画情報: {width}x{height} @ {fps:.2f}fps, {total_frames}フレーム")
    print(f"検出間隔: {det_stride}")

    # 各フレームを変換
    positions = []
    for i in range(total_frames):
        frame_index = i * det_stride
        pos = quad_to_mouth_position(quads[i], frame_index)
        positions.append(pos)

    # det_stride > 1 の場合、中間フレームを補間
    if det_stride > 1:
        positions = interpolate_positions(positions, det_stride)

    # 結果を構築
    actual_total_frames = len(positions)
    result = {
        "videoWidth": width,
        "videoHeight": height,
        "frameRate": fps,
        "totalFrames": actual_total_frames,
        "positions": positions,
    }

    return result


def interpolate_positions(positions: list[dict], stride: int) -> list[dict]:
    """
    検出間隔が開いているフレームを線形補間で埋める

    Args:
        positions: 元の位置データリスト
        stride: 検出間隔

    Returns:
        補間されたフレームを含む位置データリスト
    """
    if stride <= 1 or len(positions) < 2:
        return positions

    result = []
    keys = ["centerX", "centerY", "width", "height", "rotation"]

    for i in range(len(positions) - 1):
        current = positions[i]
        next_pos = positions[i + 1]

        # 元のフレームを追加
        result.append(current)

        # 中間フレームを補間
        for j in range(1, stride):
            t = j / stride
            interpolated = {
                "frameIndex": current["frameIndex"] + j,
            }

            for key in keys:
                v0 = current[key]
                v1 = next_pos[key]
                interpolated[key] = round(v0 + t * (v1 - v0), 2)

            result.append(interpolated)

    # 最後のフレームを追加
    result.append(positions[-1])

    return result


def main():
    parser = argparse.ArgumentParser(
        description="MotionPNGTuber の mouth_track.npz を JSON に変換"
    )
    parser.add_argument("npz", help="入力 npz ファイル")
    parser.add_argument(
        "-o", "--output",
        help="出力JSONファイル（デフォルト: 入力ファイル名.mouth.json）",
    )

    args = parser.parse_args()

    npz_path = Path(args.npz)
    if not npz_path.exists():
        print(f"エラー: npz ファイルが見つかりません: {npz_path}")
        sys.exit(1)

    # 出力パスを決定
    if args.output:
        output_path = Path(args.output)
    else:
        output_path = npz_path.with_suffix(".mouth.json")

    print(f"出力: {output_path}")

    # 変換実行
    result = convert_npz_to_json(str(npz_path))

    # JSON出力
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"完了: {output_path}")


if __name__ == "__main__":
    main()
