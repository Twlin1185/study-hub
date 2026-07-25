"""S9 — 검색 recall 개선: documents_fts를 trigram 토크나이저로 재구축 (M6 이월 ①)

계획서 §6.2 추가 구현 노트 / 설계 §4.12: "제3정규형" 본문이 "정규형" 질의에 매칭되도록
(부분어 recall) documents_fts(title, content, explanation) 가상 테이블을 DROP 후
tokenize='trigram'으로 CREATE, 동기화 트리거 재생성 + 기존 문서 백필.

API 계약 불변(GET /api/search) — 이 마이그레이션은 파생 인덱스만 재구축하며 §6.2 DDL
자체를 바꾸지 않는다(FTS5 가상 테이블은 스키마 변경이 아니라는 기존 노트 그대로).
answer는 여전히 인덱싱하지 않는다(불변 규칙 1).

trigram 토크나이저는 SQLite 3.34.0+ 가 필요하다 — 실행 전 런타임 버전을 확인해
미달이면 명확한 오류로 막는다(가드).

Revision ID: 70c7e667765f
Revises: c0ede2ef9ea5
Create Date: 2026-07-25 00:00:00.000000

"""
import sqlite3
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '70c7e667765f'
down_revision: Union[str, Sequence[str], None] = 'c0ede2ef9ea5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_MIN_SQLITE_VERSION = (3, 34, 0)


def _check_sqlite_version() -> None:
    version = tuple(int(part) for part in sqlite3.sqlite_version.split("."))
    if version < _MIN_SQLITE_VERSION:
        raise RuntimeError(
            f"documents_fts trigram 재구축은 SQLite {'.'.join(map(str, _MIN_SQLITE_VERSION))}+ "
            f"가 필요합니다 (현재 {sqlite3.sqlite_version}). SQLite를 업그레이드한 뒤 다시 "
            "마이그레이션하세요."
        )


def upgrade() -> None:
    """Upgrade schema."""
    _check_sqlite_version()

    op.execute("DROP TRIGGER IF EXISTS documents_fts_au")
    op.execute("DROP TRIGGER IF EXISTS documents_fts_ad")
    op.execute("DROP TRIGGER IF EXISTS documents_fts_ai")
    op.execute("DROP TABLE IF EXISTS documents_fts")

    op.execute(
        """
        CREATE VIRTUAL TABLE documents_fts USING fts5(
            title, content, explanation,
            content='documents', content_rowid='id',
            tokenize='trigram'
        )
        """
    )
    op.execute(
        """
        CREATE TRIGGER documents_fts_ai AFTER INSERT ON documents BEGIN
            INSERT INTO documents_fts(rowid, title, content, explanation)
            VALUES (new.id, new.title, new.content, new.explanation);
        END
        """
    )
    op.execute(
        """
        CREATE TRIGGER documents_fts_ad AFTER DELETE ON documents BEGIN
            INSERT INTO documents_fts(documents_fts, rowid, title, content, explanation)
            VALUES ('delete', old.id, old.title, old.content, old.explanation);
        END
        """
    )
    op.execute(
        """
        CREATE TRIGGER documents_fts_au AFTER UPDATE ON documents BEGIN
            INSERT INTO documents_fts(documents_fts, rowid, title, content, explanation)
            VALUES ('delete', old.id, old.title, old.content, old.explanation);
            INSERT INTO documents_fts(rowid, title, content, explanation)
            VALUES (new.id, new.title, new.content, new.explanation);
        END
        """
    )
    op.execute(
        """
        INSERT INTO documents_fts(rowid, title, content, explanation)
        SELECT id, title, content, explanation FROM documents
        """
    )


def downgrade() -> None:
    """Downgrade schema — 기본(unicode61) 토크나이저로 되돌린다."""
    op.execute("DROP TRIGGER IF EXISTS documents_fts_au")
    op.execute("DROP TRIGGER IF EXISTS documents_fts_ad")
    op.execute("DROP TRIGGER IF EXISTS documents_fts_ai")
    op.execute("DROP TABLE IF EXISTS documents_fts")

    op.execute(
        """
        CREATE VIRTUAL TABLE documents_fts USING fts5(
            title, content, explanation,
            content='documents', content_rowid='id'
        )
        """
    )
    op.execute(
        """
        CREATE TRIGGER documents_fts_ai AFTER INSERT ON documents BEGIN
            INSERT INTO documents_fts(rowid, title, content, explanation)
            VALUES (new.id, new.title, new.content, new.explanation);
        END
        """
    )
    op.execute(
        """
        CREATE TRIGGER documents_fts_ad AFTER DELETE ON documents BEGIN
            INSERT INTO documents_fts(documents_fts, rowid, title, content, explanation)
            VALUES ('delete', old.id, old.title, old.content, old.explanation);
        END
        """
    )
    op.execute(
        """
        CREATE TRIGGER documents_fts_au AFTER UPDATE ON documents BEGIN
            INSERT INTO documents_fts(documents_fts, rowid, title, content, explanation)
            VALUES ('delete', old.id, old.title, old.content, old.explanation);
            INSERT INTO documents_fts(rowid, title, content, explanation)
            VALUES (new.id, new.title, new.content, new.explanation);
        END
        """
    )
    op.execute(
        """
        INSERT INTO documents_fts(rowid, title, content, explanation)
        SELECT id, title, content, explanation FROM documents
        """
    )
