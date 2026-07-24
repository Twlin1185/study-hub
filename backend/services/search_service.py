"""전문 검색 (F12) — FTS5 가상 테이블(documents_fts) 조회 + 스니펫.

불변 규칙: 정답(answer)은 절대 노출하지 않는다 — title/content/explanation만 인덱싱
(explanation 스니펫은 검색 결과 맥락이므로 허용 — 설계 §4.9).
"""
from __future__ import annotations

import re
from typing import List, Optional, Tuple

from sqlalchemy import text
from sqlalchemy.orm import Session

SNIPPET_TOKENS = 10  # snippet() 주변 토큰 수


def _quote_token(token: str) -> str:
    """FTS5 특수문자(콜론·하이픈 등) 오작동 방지를 위해 토큰마다 큰따옴표로 감싼다."""
    escaped = token.replace('"', '""')
    return f'"{escaped}"'


def _build_match_query(q: str) -> str:
    tokens = [t for t in re.split(r"\s+", q.strip()) if t]
    if not tokens:
        return ""
    return " ".join(_quote_token(t) for t in tokens)


def search(
    db: Session, *, q: str, doc_type: Optional[str] = None, page: int = 1, size: int = 20
) -> Tuple[List[dict], int]:
    match_query = _build_match_query(q)
    if not match_query:
        return [], 0

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
