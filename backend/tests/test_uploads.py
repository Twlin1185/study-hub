"""이미지 첨부 업로드 (F54, 설계 §4.27 — S29) 판별·상한·중복 제거 회귀 테스트.

고정하는 계약:
  ① 매직 바이트 4종(png·jpg·gif·webp)만 통과 — 파일명·content-type 사칭은 판정에 영향 0
     (svg·pdf·html·exe 위조는 확장자·content-type을 image/png로 속여도 전부 422).
  ② 10MB 초과 = 422(reason='too_large') + 파일 저장 0.
  ③ 같은 내용 재업로드 = URL 동일 + 디렉터리 파일 수 증가 0(쓰기 생략, mtime 불변).
  ④ multipart 아님·file 필드 없음도 §3 규약대로 VALIDATION_ERROR(422) + detail.reason.
"""
from __future__ import annotations

import io

import pytest
from fastapi.testclient import TestClient

import main
from services import upload_service

client = TestClient(main.app)

_PNG = b"\x89PNG\r\n\x1a\n" + b"rest-of-png-body"
_JPG = b"\xff\xd8\xff" + b"rest-of-jpg-body"
_GIF = b"GIF89a" + b"rest-of-gif-body"
_WEBP = b"RIFF" + b"\x00\x00\x00\x00" + b"WEBP" + b"rest-of-webp-body"


@pytest.fixture()
def isolated_images_dir(tmp_path, monkeypatch):
    images_dir = tmp_path / "images"
    monkeypatch.setattr(upload_service, "SOURCES_IMAGES_DIR", images_dir)
    return images_dir


# ---------------------------------------------------------------------------
# ① 판별 매트릭스 — 정상 4종 통과, 사칭 전건 거부(파일명·content-type 무관)
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "data,ext",
    [(_PNG, "png"), (_JPG, "jpg"), (_GIF, "gif"), (_WEBP, "webp")],
)
def test_upload_accepts_valid_magic_bytes_and_returns_url(isolated_images_dir, data, ext):
    resp = client.post(
        "/api/uploads", files={"file": ("photo.bin", io.BytesIO(data), "application/octet-stream")}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert set(body.keys()) == {"url"}
    assert body["url"].startswith(f"/images/")
    assert body["url"].endswith(f".{ext}")
    saved = list(isolated_images_dir.glob(f"*.{ext}"))
    assert len(saved) == 1
    assert saved[0].read_bytes() == data


@pytest.mark.parametrize(
    "payload,fake_filename,fake_ctype",
    [
        (b"<!DOCTYPE html><html>error page</html>", "x.png", "image/png"),
        (b"%PDF-1.4 fake pdf body", "x.png", "image/png"),
        (b"<svg xmlns='http://www.w3.org/2000/svg'></svg>", "x.png", "image/png"),
        (b"MZ\x90\x00\x03\x00\x00\x00exe-body", "x.png", "image/png"),
    ],
)
def test_upload_rejects_disguised_non_image_regardless_of_filename_or_content_type(
    isolated_images_dir, payload, fake_filename, fake_ctype
):
    resp = client.post("/api/uploads", files={"file": (fake_filename, io.BytesIO(payload), fake_ctype)})
    assert resp.status_code == 422
    body = resp.json()
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert body["error"]["detail"]["reason"] == "unsupported_type"
    assert list(isolated_images_dir.glob("*")) == []  # 거부 시 파일 시스템 부작용 0


# ---------------------------------------------------------------------------
# ② 10MB 초과 상한 조기 차단
# ---------------------------------------------------------------------------
def test_upload_rejects_over_10mb_and_writes_nothing(isolated_images_dir):
    oversized = _PNG + b"\x00" * (upload_service.MAX_UPLOAD_BYTES + 1 - len(_PNG))
    assert len(oversized) == upload_service.MAX_UPLOAD_BYTES + 1
    resp = client.post(
        "/api/uploads", files={"file": ("big.png", io.BytesIO(oversized), "image/png")}
    )
    assert resp.status_code == 422
    body = resp.json()
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert body["error"]["detail"]["reason"] == "too_large"
    assert not isolated_images_dir.exists() or list(isolated_images_dir.glob("*")) == []


def test_upload_accepts_file_at_exactly_10mb_boundary(isolated_images_dir):
    exact = _PNG + b"\x00" * (upload_service.MAX_UPLOAD_BYTES - len(_PNG))
    assert len(exact) == upload_service.MAX_UPLOAD_BYTES
    resp = client.post("/api/uploads", files={"file": ("exact.png", io.BytesIO(exact), "image/png")})
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# ③ 중복 업로드 = 파일 1개(쓰기 생략, mtime 불변)
# ---------------------------------------------------------------------------
def test_upload_dedupes_identical_content_without_rewriting(isolated_images_dir):
    resp1 = client.post("/api/uploads", files={"file": ("a.png", io.BytesIO(_PNG), "image/png")})
    assert resp1.status_code == 200
    url1 = resp1.json()["url"]
    saved = list(isolated_images_dir.glob("*.png"))
    assert len(saved) == 1
    mtime_before = saved[0].stat().st_mtime_ns

    resp2 = client.post("/api/uploads", files={"file": ("b.png", io.BytesIO(_PNG), "image/png")})
    assert resp2.status_code == 200
    url2 = resp2.json()["url"]

    assert url1 == url2
    saved_after = list(isolated_images_dir.glob("*.png"))
    assert len(saved_after) == 1  # 디렉터리 파일 수 증가 0
    assert saved_after[0].stat().st_mtime_ns == mtime_before  # 기존 파일 mtime 불변


# ---------------------------------------------------------------------------
# ④ 요청 형식·필드 오류 — §3 규약(VALIDATION_ERROR + detail.reason)
# ---------------------------------------------------------------------------
def test_upload_rejects_non_multipart_request():
    resp = client.post("/api/uploads", json={"url": "https://example.com/a.png"})
    assert resp.status_code == 422
    body = resp.json()
    assert body["error"]["code"] == "VALIDATION_ERROR"


def test_upload_rejects_empty_file_field(isolated_images_dir):
    resp = client.post("/api/uploads", files={"file": ("empty.png", io.BytesIO(b""), "image/png")})
    assert resp.status_code == 422
    body = resp.json()
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert body["error"]["detail"]["reason"] == "no_file"
