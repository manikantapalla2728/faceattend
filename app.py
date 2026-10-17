import base64
import io
import json
import threading
import urllib.request
from pathlib import Path

import cv2
import numpy as np
from flask import Flask, jsonify, request
from flask_cors import CORS
from PIL import Image, ImageOps

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

MODEL_DIRECTORY = Path(__file__).resolve().parent / "models"
MODEL_URLS = {
    "yunet": (
        "face_detection_yunet_2023mar.onnx",
        "https://github.com/opencv/opencv_zoo/raw/refs/heads/main/"
        "models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
    ),
    "sface": (
        "face_recognition_sface_2021dec.onnx",
        "https://github.com/opencv/opencv_zoo/raw/refs/heads/main/"
        "models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
    ),
}
MAX_IMAGE_DIMENSION = 1920
COSINE_MATCH_THRESHOLD = 0.363

_model_initialization_lock = threading.Lock()
_opencv_lock = threading.Lock()
_face_detector = None
_face_recognizer = None


def _download_model(filename, url):
    MODEL_DIRECTORY.mkdir(parents=True, exist_ok=True)
    model_path = MODEL_DIRECTORY / filename
    if model_path.is_file() and model_path.stat().st_size > 1024:
        return model_path

    temporary_path = model_path.with_suffix(model_path.suffix + ".part")
    try:
        request_object = urllib.request.Request(
            url, headers={"User-Agent": "FaceAttend/1.0"}
        )
        with urllib.request.urlopen(request_object, timeout=60) as response:
            with temporary_path.open("wb") as model_file:
                while chunk := response.read(1024 * 1024):
                    model_file.write(chunk)
        if temporary_path.stat().st_size < 1024:
            raise RuntimeError(f"Downloaded OpenCV model is empty: {filename}")
        temporary_path.replace(model_path)
    except Exception as error:
        temporary_path.unlink(missing_ok=True)
        raise RuntimeError(
            f"Could not download the OpenCV {filename} model. "
            "Check your internet connection and try again."
        ) from error
    return model_path


def _get_models():
    global _face_detector, _face_recognizer
    if _face_detector is not None and _face_recognizer is not None:
        return _face_detector, _face_recognizer

    with _model_initialization_lock:
        if _face_detector is None or _face_recognizer is None:
            yunet_path = _download_model(*MODEL_URLS["yunet"])
            sface_path = _download_model(*MODEL_URLS["sface"])
            try:
                detector = cv2.FaceDetectorYN.create(
                    str(yunet_path), "", (320, 320), 0.7, 0.3, 5000
                )
                recognizer = cv2.FaceRecognizerSF.create(str(sface_path), "")
            except cv2.error as error:
                raise RuntimeError(
                    "OpenCV could not load its YuNet/SFace models. "
                    "Delete the files in the models folder and retry."
                ) from error
            _face_detector = detector
            _face_recognizer = recognizer
    return _face_detector, _face_recognizer


def _decode_image(image_bytes):
    with Image.open(io.BytesIO(image_bytes)) as image:
        image = ImageOps.exif_transpose(image).convert("RGB")
        rgb_image = np.asarray(image, dtype=np.uint8)

    height, width = rgb_image.shape[:2]
    scale = min(1.0, MAX_IMAGE_DIMENSION / max(height, width))
    if scale < 1.0:
        resized_width = max(1, round(width * scale))
        resized_height = max(1, round(height * scale))
        rgb_image = cv2.resize(
            rgb_image,
            (resized_width, resized_height),
            interpolation=cv2.INTER_AREA,
        )
    return cv2.cvtColor(rgb_image, cv2.COLOR_RGB2BGR), width, height


def _decode_base64_image(b64_string):
    if not isinstance(b64_string, str) or not b64_string.strip():
        raise ValueError("Image data is empty")
    if "," in b64_string:
        b64_string = b64_string.split(",", 1)[1]
    image_bytes = base64.b64decode("".join(b64_string.split()), validate=True)
    return _decode_image(image_bytes)


def _feature_for_face(image, face, recognizer):
    aligned_face = recognizer.alignCrop(image, face)
    feature = recognizer.feature(aligned_face).flatten().astype(np.float32)
    norm = np.linalg.norm(feature)
    if norm == 0:
        raise RuntimeError("OpenCV returned an empty face embedding")
    return feature / norm


def _analyze_image(image):
    detector, recognizer = _get_models()
    with _opencv_lock:
        detector.setInputSize((image.shape[1], image.shape[0]))
        _, detected_faces = detector.detect(image)
        if detected_faces is None:
            return [], []

        boxes = []
        features = []
        for face in detected_faces:
            x, y, width, height = face[:4]
            left = max(0, int(np.floor(x)))
            top = max(0, int(np.floor(y)))
            right = min(image.shape[1], int(np.ceil(x + width)))
            bottom = min(image.shape[0], int(np.ceil(y + height)))
            if right <= left or bottom <= top:
                continue
            boxes.append((top, right, bottom, left))
            features.append(_feature_for_face(image, face, recognizer))
    return boxes, features


def _scale_box(box, source_width, source_height, image_width, image_height):
    top, right, bottom, left = box
    scale_x = source_width / image_width
    scale_y = source_height / image_height
    return [
        round(top * scale_y),
        round(right * scale_x),
        round(bottom * scale_y),
        round(left * scale_x),
    ]


def _error_response(message, boxes=None):
    return jsonify(
        {
            "present": [],
            "boxes": boxes or [],
            "matches": [None] * len(boxes or []),
            "error": message,
        }
    )


@app.route("/process", methods=["POST"])
def process():
    students_json = request.form.get("students", "[]")
    try:
        students = json.loads(students_json)
    except (TypeError, json.JSONDecodeError):
        return _error_response("Invalid students JSON")
    if not isinstance(students, list):
        return _error_response("Students must be a JSON array")

    class_file = request.files.get("class_image")
    if class_file is None:
        return _error_response("No class image uploaded")

    try:
        class_image, class_width, class_height = _decode_image(class_file.read())
    except Exception as error:
        return _error_response(f"Cannot read class image: {error}")

    try:
        class_boxes, class_features = _analyze_image(class_image)
    except Exception as error:
        return _error_response(f"OpenCV face analysis failed: {error}")
    output_boxes = [
        _scale_box(box, class_width, class_height, class_image.shape[1], class_image.shape[0])
        for box in class_boxes
    ]
    if not class_boxes:
        return _error_response("No faces detected in class image")

    student_features = []
    student_rolls = []
    skipped_students = 0
    for student in students:
        if not isinstance(student, dict):
            skipped_students += 1
            continue
        roll = student.get("roll", "")
        if not isinstance(roll, str) or not roll.strip():
            skipped_students += 1
            continue
        try:
            student_image, _, _ = _decode_base64_image(student.get("image", ""))
        except (TypeError, ValueError, OSError):
            skipped_students += 1
            continue
        try:
            _, features = _analyze_image(student_image)
        except Exception as error:
            return _error_response(
                f"OpenCV face analysis failed for student {roll.strip()}: {error}",
                output_boxes,
            )
        if features:
            student_features.append(features[0])
            student_rolls.append(roll.strip())
        else:
            skipped_students += 1

    if not student_features:
        message = "No valid student faces found"
        if skipped_students:
            message += f" ({skipped_students} student photos were skipped)"
        return _error_response(message, output_boxes)

    templates = np.stack(student_features)
    present = []
    matches = []
    for class_feature in class_features:
        similarities = templates @ class_feature
        best_index = int(np.argmax(similarities))
        score = float(similarities[best_index])
        if score >= COSINE_MATCH_THRESHOLD:
            roll = student_rolls[best_index]
            matches.append({"roll": roll, "confidence": round(score, 4)})
            if roll not in present:
                present.append(roll)
        else:
            matches.append(None)

    return jsonify(
        {
            "present": present,
            "boxes": output_boxes,
            "matches": matches,
            "skipped_students": skipped_students,
        }
    )


@app.route("/ping", methods=["GET"])
def ping():
    return jsonify({"status": "ok", "engine": "OpenCV YuNet + SFace"})


if __name__ == "__main__":
    app.run(debug=True, port=5000)
