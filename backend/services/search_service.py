"""전문 검색 (F12) — FTS5 가상 테이블(documents_fts) 조회 + 스니펫.

불변 규칙: 정답(answer)은 절대 노출하지 않는다 — title/content/explanation만 인덱싱
(explanation 스니펫은 검색 결과 맥락이므로 허용 — 설계 §4.9).

S9(M6 이월 ①, 설계 §4.12): documents_fts는 `tokenize='trigram'`으로 재구축됐다(Alembic
70c7e667765f) — "제3정규형" 본문이 "정규형" 질의에 매칭되는 부분어 recall을 위해서다.
trigram은 3자 미만 토큰을 인덱싱하지 못하므로, 질의 토큰 중 **3자 이상만 MATCH에
사용**하고 전 토큰이 2자 이하면(예: "DB") `title/content` LIKE로 폴백한다. API 계약
(GET /api/search 요청·응답)은 그대로다.
"""
from __future__ import annotations

import re
from typing import List, Optional, Tuple

from sqlalchemy import text
from sqlalchemy.orm import Session

SNIPPET_TOKENS = 10  # FTS snippet() 주변 토큰 수
MIN_TRIGRAM_TOKEN_LEN = 3  # trigram이 인덱싱 가능한 최소 토큰 길이
LIKE_SNIPPET_WINDOW = 60  # LIKE 폴백 스니펫 좌우 글자 수(대략)


def _quote_token(token: str) -> str:
    """FTS5 특수문자(콜론·하이픈 등) 오작동 방지를 위해 토큰마다 큰따옴표로 감싼다."""
    escaped = token.replace('"', '""')
    return f'"{escaped}"'


def _build_match_query(q: str) -> str:
    """3자 이상 토큰만 MATCH 절에 사용 — trigram은 그보다 짧은 토큰을 인덱싱하지 않는다."""
    tokens = [t for t in re.split(r"\s+", q.strip()) if t]
    long_tokens = [t for t in tokens if len(t) >= MIN_TRIGRAM_TOKEN_LEN]
    if not long_tokens:
        return ""
    return " ".join(_quote_token(t) for t in long_tokens)


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _plain_snippet(title: str, content: Optional[str], q: str) -> str:
    """LIKE 폴백용 "단순 발췌" — 하이라이트 없이 매칭 지점 주변만 잘라 보여준다."""
    source = content or title or ""
    needle = q.strip().lower()
    idx = source.lower().find(needle) if needle else -1
    if idx == -1:
        excerpt = source[: LIKE_SNIPPET_WINDOW * 2]
        return excerpt + ("…" if len(source) > len(excerpt) else "")

    start = max(0, idx - LIKE_SNIPPET_WINDOW)
    end = min(len(source), idx + len(needle) + LIKE_SNIPPET_WINDOW)
    prefix = "…" if start > 0 else ""
    suffix = "…" if end < len(source) else ""
    return f"{prefix}{source[start:end]}{suffix}"


def _search_like_fallback(
    db: Session, *, q: str, doc_type: Optional[str], page: int, size: int
) -> Tuple[List[dict], int]:
    """전 토큰이 2자 이하일 때 title/content LIKE 폴백(최신순 정렬, 설계 §4.12)."""
    pattern = f"%{_escape_like(q.strip())}%"
    type_filter = "AND d.type = :doc_type" if doc_type else ""
    params = {"pattern": pattern, "size": size, "offset": (page - 1) * size}
    if doc_type:
        params["doc_type"] = doc_type

    count_row = db.execute(
        text(
            f"""
            SELECT COUNT(*)
            FROM documents d
            WHERE d.is_active = 1 {type_filter}
              AND (d.title LIKE :pattern ESCAPE '\\' OR d.content LIKE :pattern ESCAPE '\\')
            """
        ),
        params,
    ).first()
    total = count_row[0] if count_row else 0
    if total == 0:
        return [], 0

    rows = db.execute(
        text(
            f"""
            SELECT d.id AS document_id, d.doc_no AS doc_no, d.type AS type,
                   d.title AS title, d.content AS content
            FROM documents d
            WHERE d.is_active = 1 {type_filter}
              AND (d.title LIKE :pattern ESCAPE '\\' OR d.content LIKE :pattern ESCAPE '\\')
            ORDER BY d.id DESC
            LIMIT :size OFFSET :offset
            """
        ),
        params,
    ).all()

    items = [
        {
            "document_id": row.document_id,
            "doc_no": row.doc_no,
            "type": row.type,
            "title": row.title,
            "snippet": _plain_snippet(row.title, row.content, q),
        }
        for row in rows
    ]
    return items, total


def search(
    db: Session, *, q: str, doc_type: Optional[str] = None, page: int = 1, size: int = 20
) -> Tuple[List[dict], int]:
    match_query = _build_match_query(q)
    if not match_query:
        return _search_like_fallback(db, q=q, doc_type=doc_type, page=page, size=size)

    type_filter = "AND d.type = :doc_type" if doc_type else ""
    params = {"match_query": match_query, "size": size, "offset": (page - 1) * size}
    if doc_type:
        params["doc_type"] = doc_type

    count_row = db.execute(
        text(
            f"""
            SELECT COUNT(*)
            FROM documents_fts
            JOIN documents d ON d.id = documents_fts.rowid
            WHERE documents_fts MATCH :match_query AND d.is_active = 1 {type_filter}
            """
        ),
        params,
    ).first()
    total = count_row[0] if count_row else 0
    if total == 0:
        return [], 0

    rows = db.execute(
        text(
            f"""
            SELECT
                d.id AS document_id,
                d.doc_no AS doc_no,
                d.type AS type,
                d.title AS title,
                snippet(documents_fts, 0, '<mark>', '</mark>', '…', {SNIPPET_TOKENS}) AS title_snippet,
                snippet(documents_fts, 1, '<mark>', '</mark>', '…', {SNIPPET_TOKENS}) AS content_snippet,
                snippet(documents_fts, 2, '<mark>', '</mark>', '…', {SNIPPET_TOKENS}) AS explanation_snippet,
                bm25(documents_fts) AS rank
            FROM documents_fts
            JOIN documents d ON d.id = documents_fts.rowid
            WHERE documents_fts MATCH :match_query AND d.is_active = 1 {type_filter}
            ORDER BY rank
            LIMIT :size OFFSET :offset
            """
        ),
        params,
    ).all()

    items = []
    for row in rows:
        # 실제로 하이라이트(<mark>)된 필드를 우선 노출 — 본문 > 해설 > 제목 순
        snippet = row.content_snippet
        for candidate in (row.content_snippet, row.explanation_snippet, row.title_snippet):
            if candidate and "<mark>" in candidate:
                snippet = candidate
                break
        items.append(
            {
                "document_id": row.document_id,
                "doc_no": row.doc_no,
                "type": row.type,
                "title": row.title,
                "snippet": snippet or "",
            }
        )
    return items, total
