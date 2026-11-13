#!/usr/bin/env python3
"""Detector worker — runs inside the analyzer checkout's Python environment.

Started by `client.py` with::

    python worker.py <analyzer_root> <court_engine.trt> <ball_engine.trt>

Protocol: one JSON object per line on stdin/stdout.  Everything the detector
libraries print is redirected to stderr so stdout stays a clean channel.
"""

from __future__ import annotations

import base64
import json
import os
import sys
import traceback


def main() -> int:
    if len(sys.argv) < 4:
        print("usage: worker.py ANALYZER_ROOT COURT_TRT BALL_TRT", file=sys.stderr)
        return 2

    root = os.path.abspath(sys.argv[1])
    court_model = os.path.abspath(sys.argv[2])
    ball_model = os.path.abspath(sys.argv[3])

    # Keep a private handle on the real stdout for the protocol, then point fd 1
    # at stderr so any print() from the detector libraries cannot corrupt it.
    protocol = os.fdopen(os.dup(1), "w", buffering=1, encoding="utf-8")
    os.dup2(2, 1)

    def emit(payload: dict) -> None:
        protocol.write(json.dumps(payload, ensure_ascii=False) + "\n")
        protocol.flush()

    sys.path.insert(0, root)
    try:
        import cv2
        import numpy as np
        from perception.keypoint_detector import KeypointDetector
        from perception.object_detector import ObjectDetector
        from utils import filter_detections
    except Exception:  # noqa: BLE001 - report the failure to the client
        emit({"event": "error", "error": traceback.format_exc(limit=4)})
        return 1

    def decode(payload: str) -> "np.ndarray":
        raw = base64.b64decode(payload)
        image = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("image illisible")
        return image

    try:
        court = KeypointDetector(court_model)
        ball = ObjectDetector(ball_model)
    except Exception:  # noqa: BLE001
        emit({"event": "error", "error": traceback.format_exc(limit=4)})
        return 1

    emit({"event": "ready", "models": {"court": court_model, "ball": ball_model}})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            continue
        request_id = request.get("id")
        command = request.get("command")
        try:
            if command == "ping":
                emit({"id": request_id, "ok": True})
            elif command == "shutdown":
                emit({"id": request_id, "ok": True})
                return 0
            elif command == "court":
                image = decode(request["image"])
                height, width = image.shape[:2]
                keypoints = court.predict(image)
                pairs = [
                    [round(float(keypoints[i]), 3), round(float(keypoints[i + 1]), 3)]
                    for i in range(0, min(28, len(keypoints)) - 1, 2)
                ]
                emit(
                    {
                        "id": request_id,
                        "ok": True,
                        "width": int(width),
                        "height": int(height),
                        "keypoints": pairs,
                    }
                )
            elif command == "ball":
                threshold = float(request.get("threshold", 0.35))
                detections = []
                for item in request.get("frames", []):
                    image = decode(item["image"])
                    prediction = ball.predict(image)
                    boxes, scores, _labels = filter_detections(
                        prediction, threshold, [32]
                    )
                    if boxes is None or len(scores) == 0:
                        detections.append({"frame": item.get("frame"), "found": False})
                        continue
                    best = int(scores.argmax())
                    box = boxes[best]
                    detections.append(
                        {
                            "frame": item.get("frame"),
                            "found": True,
                            "x": float((box[0] + box[2]) / 2.0),
                            "y": float((box[1] + box[3]) / 2.0),
                            "score": float(scores[best]),
                        }
                    )
                emit({"id": request_id, "ok": True, "detections": detections})
            else:
                emit({"id": request_id, "ok": False, "error": f"commande inconnue: {command}"})
        except Exception:  # noqa: BLE001 - keep the worker alive
            emit(
                {
                    "id": request_id,
                    "ok": False,
                    "error": traceback.format_exc(limit=4),
                }
            )
    return 0


if __name__ == "__main__":
    sys.exit(main())
