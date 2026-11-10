"""stage-58 보안 신뢰 경계 회귀 (FB-37) — 경로 id 가드 · Host/Origin 미들웨어 · 업로드 상한 ·
claude CLI 인자. LLM 0 · 실 study.db/improve/backups 무접촉(임시 디렉터리 monkeypatch)."""
from __future__ import annotations

import socket

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import main
from database import Base, get_db
from exceptions import NotFoundError
from services import backup_service, convert_service, improve_service, split_service, upload_service

client = TestClient(main.app)

_BAD_IDS = [
    "..%5C..%5Cx",
    "%2E%2E%2Fx",
    "C:%5CWindows%5Cwin",
    "..",
    "a.b",
]


def _routable(bad: str) -> bool:
    """HTTP 계층에서 라우트 세그먼트까지 도달하는 id만(`%2F`·`..`은 URL 정규화/라우팅에서 이미
    걸러짐 — 서비스 계층 가드는 직접 호출로 검증)."""
    return "%2F" not in bad.upper() and bad != ".."


# ---------------------------------------------------------------------------
# ⓐ 경로 탈출 — 전 지점 404 + 대상 디렉터리 밖 파일 무접촉
# ---------------------------------------------------------------------------
@pytest.fixture()
def sandbox(tmp_path, monkeypatch):
    cases = tmp_path / "improve" / "cases"
    proposals = tmp_path / "improve" / "proposals"
    cases.mkdir(parents=True)
    proposals.mkdir(parents=True)
    monkeypatch.setattr(improve_service, "CASES_DIR", cases)
    monkeypatch.setattr(improve_service, "PROPOSALS_DIR", proposals)
    backups = tmp_path / "backups"
    backups.mkdir()
    monkeypatch.setattr(backup_service, "BACKUPS_DIR", backups)
    split_dir = tmp_path / "split"
    split_dir.mkdir()
    monkeypatch.setattr(split_service, "SPLIT_DIR", split_dir)
    # 대상 디렉터리 밖 파일들(탈출 시 읽히거나 지워질 수 있는 것)
    outside = {
        tmp_path / "improve" / "x.json": '{"case_id": "x"}',
        tmp_path / "x.json": '{"split_id": "x"}',
        tmp_path / "x.db": "db",
    }
    for path, text in outside.items():
        path.write_text(text, encoding="utf-8")
    yield tmp_path
    for path, text in outside.items():
        assert path.exists() and path.read_text(encoding="utf-8") == text


@pytest.mark.parametrize("bad", _BAD_IDS)
def test_improve_case_and_proposal_paths_reject_bad_ids(sandbox, bad):
    from urllib.parse import unquote

    raw = unquote(bad)
    for fn in (
        improve_service._case_path,
        improve_service._case_output_path,
        improve_service._proposal_path,
    ):
        with pytest.raises(NotFoundError):
            fn(raw)
    if _routable(bad):
        assert client.get(f"/api/improve/cases/{bad}").status_code == 404
        assert client.delete(f"/api/improve/cases/{bad}").status_code == 404
        assert client.get(f"/api/improve/proposals/{bad}").status_code == 404


def test_improve_valid_ids_still_resolve(sandbox):
    assert improve_service._case_path("fc_abc123").name == "fc_abc123.json"
    assert improve_service._proposal_path("pr_abc123").name == "pr_abc123.json"


@pytest.mark.parametrize("bad", _BAD_IDS)
def test_backup_restore_rejects_bad_ids(sandbox, bad):
    from urllib.parse import unquote

    with pytest.raises(NotFoundError):
        backup_service.restore_backup(unquote(bad), "RESTORE")
    if _routable(bad):
        resp = client.post(f"/api/backups/{bad}/restore", json={"confirm": "RESTORE"})
        assert resp.status_code == 404
        assert resp.json()["error"]["code"] == "NOT_FOUND"


@pytest.mark.parametrize("bad", _BAD_IDS)
def test_split_state_rejects_bad_ids(sandbox, bad):
    from urllib.parse import unquote

    assert split_service._load_state_from_disk(unquote(bad)) is None
    if _routable(bad):
        assert client.get(f"/api/import/split/{bad}").status_code == 404


# ---------------------------------------------------------------------------
# ⓑ~ⓓ Host / Origin 미들웨어
# ---------------------------------------------------------------------------
def _get(host: str):
    return client.get("/api/app-version", headers={"Host": host})


@pytest.mark.parametrize(
    "host",
    [
        "localhost:8000",
        "192.168.0.5:8000",
        "[::1]:8000",
        socket.gethostname(),
        socket.gethostname().upper() + ":8000",
        socket.gethostname() + ".local",
        "testserver",  # conftest의 STUDY_HUB_ALLOWED_HOSTS
    ],
)
def test_host_allowed(host):
    assert _get(host).status_code == 200


def test_host_rejected_evil_example():
    resp = _get("evil.example")
    assert resp.status_code == 403
    body = resp.json()["error"]
    assert body["code"] == "VALIDATION_ERROR"
    assert body["detail"] == {"reason": "host_not_allowed"}


def test_host_env_extra_is_monkeypatchable(monkeypatch):
    assert _get("my-pc.lan").status_code == 403
    monkeypatch.setattr(main, "_EXTRA_ALLOWED_HOSTS", {"my-pc.lan"})
    assert _get("my-pc.lan:8000").status_code == 200


_RESTORE = "/api/backups/zz/restore"


def _post(origin: str | None, host: str = "localhost:8000"):
    headers = {"Host": host}
    if origin is not None:
        headers["Origin"] = origin
    return client.post(_RESTORE, json={"confirm": "nope"}, headers=headers)


@pytest.mark.parametrize("origin", ["http://evil.example", "http://localhost:5173", "null"])
def test_origin_mismatch_rejected(origin):
    resp = _post(origin)
    assert resp.status_code == 403
    assert resp.json()["error"]["detail"] == {"reason": "origin_mismatch"}


def test_origin_same_host_missing_and_get_pass():
    assert _post("http://localhost:8000").status_code == 422  # 확인 문구 오류 = 가드 통과
    assert _post("http://LOCALHOST:8000").status_code == 422
    assert _post(None).status_code == 422
    resp = client.get(
        "/api/app-version", headers={"Host": "localhost:8000", "Origin": "http://evil.example"}
    )
    assert resp.status_code == 200  # GET은 Origin 검사 0


# ---------------------------------------------------------------------------
# ⓔ 업로드 상한
# ---------------------------------------------------------------------------
@pytest.fixture()
def mem_db_override():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    def _override():
        s = factory()
        try:
            yield s
        finally:
            s.close()

    main.app.dependency_overrides[get_db] = _override
    yield
    main.app.dependency_overrides.pop(get_db, None)
    engine.dispose()


@pytest.mark.parametrize("size", [150, 20_000])  # 150 = 스트리밍 차단 · 20000 = Content-Length 1차 차단
def test_upload_limit_three_routes(monkeypatch, mem_db_override, size):
    monkeypatch.setattr(convert_service, "MAX_DOWNLOAD_BYTES", 100)
    data = b"a" * size

    for url in ("/api/convert", "/api/import/split"):
        resp = client.post(url, files={"file": ("big.txt", data, "text/plain")})
        assert resp.status_code == 422, url
        err = resp.json()["error"]
        assert err["code"] == "VALIDATION_ERROR"
        assert err["detail"]["reason"] == "upload_too_large"

    resp = client.post("/api/import/preview", files={"file": ("big.json", data, "application/json")})
    assert resp.status_code == 422
    assert resp.json()["error"]["detail"]["reason"] == "upload_too_large"

    resp = client.post(
        "/api/import/answer-key",
        files={"file": ("k.txt", data, "text/plain")},
        data={"category_id": "1"},
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["detail"]["reason"] == "upload_too_large"


def test_upload_helpers_under_limit_pass():
    mini = FastAPI()

    @mini.post("/form")
    async def form_route(request: Request):
        form = await upload_service.parse_form_limited(request, 100)
        return {"n": len(await form["file"].read()), "k": form.get("k")}

    @mini.post("/up")
    async def up_route(request: Request):
        form = await request.form()
        data = await upload_service.read_upload_limited(form["file"], 100)
        return {"n": len(data)}

    mc = TestClient(mini)
    ok = mc.post("/form", files={"file": ("a.txt", b"x" * 100, "text/plain")}, data={"k": "v"})
    assert ok.status_code == 200 and ok.json() == {"n": 100, "k": "v"}
    assert mc.post("/up", files={"file": ("a.txt", b"x" * 100, "text/plain")}).json() == {"n": 100}


def test_read_upload_limited_without_size_reads_chunks():
    class _Fake:
        size = None

        def __init__(self, n: int) -> None:
            self._left = n

        async def read(self, n: int = -1) -> bytes:
            take = self._left if n < 0 else min(n, self._left)
            self._left -= take
            return b"x" * take

    import asyncio

    assert len(asyncio.run(upload_service.read_upload_limited(_Fake(50), 100))) == 50
    with pytest.raises(Exception) as ei:
        asyncio.run(upload_service.read_upload_limited(_Fake(101), 100))
    assert getattr(ei.value, "detail", {}).get("reason") == "upload_too_large"


# ---------------------------------------------------------------------------
# ⓕ claude CLI 인자
# ---------------------------------------------------------------------------
def test_claude_cli_args_read_only_and_no_bypass():
    args = convert_service._claude_cli_args("claude.exe", None)
    assert args[0] == "claude.exe"
    assert "bypassPermissions" not in args
    assert "--permission-mode" not in args
    assert args[args.index("--tools") + 1] == "Read"
    assert args[args.index("--allowedTools") + 1] == "Read"
    assert "--strict-mcp-config" in args and "--mcp-config" not in args
    assert "--model" not in args


def test_claude_cli_args_model_branch():
    args = convert_service._claude_cli_args("claude.exe", "opus")
    assert args[-2:] == ["--model", "opus"]
