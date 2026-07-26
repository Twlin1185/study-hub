# -*- coding: utf-8 -*-
"""SPA 폴백 경로 탈출 회귀 테스트 (2026-07-26 S12 검토 발견)."""
from fastapi.testclient import TestClient

import main


client = TestClient(main.app)


def test_spa_fallback_blocks_encoded_traversal_to_db():
    resp = client.get("/..%2f..%2fstudy.db")
    assert resp.status_code == 200
    assert b"SQLite format 3" not in resp.content  # DB 원본이 새면 안 된다
    assert b"<!doctype html" in resp.content.lower() or b"<html" in resp.content.lower()


def test_spa_fallback_blocks_escape_outside_project():
    resp = client.get("/" + "..%2f" * 9 + "Windows%2fwin.ini")
    assert resp.status_code == 200
    assert b"[fonts]" not in resp.content and b"for 16-bit app support" not in resp.content


def test_spa_fallback_blocks_source_disclosure():
    for path in ("/..%2fpackage.json", "/..%2f..%2fbackend%2fmain.py", "/..%2fbackend%2fmodels.py"):
        resp = client.get(path)
        assert resp.status_code == 200, path
        assert b"spa_fallback" not in resp.content, path
        assert b'"dependencies"' not in resp.content, path


def test_spa_fallback_still_serves_app_routes():
    for path in ("/settings", "/explore", "/exam"):
        resp = client.get(path)
        assert resp.status_code == 200, path
        assert "text/html" in resp.headers.get("content-type", ""), path


def test_api_unknown_path_still_json_404():
    resp = client.get("/api/does-not-exist")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"
