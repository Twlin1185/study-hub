"""SQLAlchemy 모델.

스키마 단일 출처: docs/01-plan/study-app.plan.md §6.2 (DDL 그대로 반영).
임의로 컬럼/테이블을 추가·변경하지 않는다 — 변경이 필요하면 계획서를 먼저 갱신할 것.
"""
from __future__ import annotations

import datetime as dt

from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    REAL,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class Category(Base):
    """분류 트리 (자기참조)."""

    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"))
    name: Mapped[str] = mapped_column(Text, nullable=False)
    level_hint: Mapped[str | None] = mapped_column(Text)
    exam_date: Mapped[dt.date | None] = mapped_column(Date)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime, server_default=func.current_timestamp()
    )


class Document(Base):
    """문서 (콘텐츠의 단일 출처)."""

    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    doc_no: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    type: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[str | None] = mapped_column(Text)
    choices: Mapped[str | None] = mapped_column(Text)
    answer: Mapped[str | None] = mapped_column(Text)
    explanation: Mapped[str | None] = mapped_column(Text)
    difficulty: Mapped[int | None] = mapped_column(Integer)
    source_id: Mapped[int | None] = mapped_column(ForeignKey("sources.id"))
    source_detail: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[int] = mapped_column(Integer, default=1)
    forked_from: Mapped[int | None] = mapped_column(ForeignKey("documents.id"))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime, server_default=func.current_timestamp()
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime,
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp(),
    )


class CategoryDocument(Base):
    """분류-문서 다대다 연결."""

    __tablename__ = "category_documents"

    category_id: Mapped[int] = mapped_column(
        ForeignKey("categories.id"), primary_key=True
    )
    document_id: Mapped[int] = mapped_column(
        ForeignKey("documents.id"), primary_key=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    local_note: Mapped[str | None] = mapped_column(Text)
    linked_at: Mapped[dt.datetime] = mapped_column(
        DateTime, server_default=func.current_timestamp()
    )
    linked_by: Mapped[str] = mapped_column(Text, default="manual", server_default="manual")
    linked_rule_id: Mapped[int | None] = mapped_column(ForeignKey("tag_rules.id"))

    __table_args__ = (Index("ix_category_documents_document_id", "document_id"),)


class Attempt(Base):
    """풀이 기록."""

    __tablename__ = "attempts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    document_id: Mapped[int] = mapped_column(
        ForeignKey("documents.id"), nullable=False
    )
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"))
    my_answer: Mapped[str | None] = mapped_column(Text)
    is_correct: Mapped[int] = mapped_column(Integer, nullable=False)
    time_spent: Mapped[int | None] = mapped_column(Integer)
    # 'quiz'|'review'|'flashcard'|'study'|'exam' (자유 텍스트 — CHECK 제약 없음. 'exam'은
    # S11 모의고사, 배치 공통 answered_at이 응시 런 키 — 계획서 §14 F25, 설계 §4.14)
    mode: Mapped[str | None] = mapped_column(Text)
    answered_at: Mapped[dt.datetime] = mapped_column(
        DateTime, server_default=func.current_timestamp()
    )

    __table_args__ = (
        Index("ix_attempts_document_id", "document_id"),
        Index("ix_attempts_answered_at", "answered_at"),
    )


class ReviewNote(Base):
    """오답노트 (문서당 1개)."""

    __tablename__ = "review_notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    document_id: Mapped[int] = mapped_column(
        ForeignKey("documents.id"), unique=True, nullable=False
    )
    note: Mapped[str | None] = mapped_column(Text)
    wrong_reason: Mapped[str | None] = mapped_column(Text)
    is_resolved: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime, server_default=func.current_timestamp()
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime,
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp(),
    )


class SrsCard(Base):
    """간격반복 카드 (SM-2). 문서당 1개."""

    __tablename__ = "srs_cards"

    document_id: Mapped[int] = mapped_column(
        ForeignKey("documents.id"), primary_key=True
    )
    ease_factor: Mapped[float] = mapped_column(REAL, default=2.5)
    interval_days: Mapped[int] = mapped_column(Integer, default=0)
    repetitions: Mapped[int] = mapped_column(Integer, default=0)
    due_date: Mapped[dt.date | None] = mapped_column(Date)
    last_reviewed: Mapped[dt.datetime | None] = mapped_column(DateTime)

    __table_args__ = (Index("ix_srs_cards_due_date", "due_date"),)


class Source(Base):
    """원본 파일 (sources/ — 불변)."""

    __tablename__ = "sources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    filename: Mapped[str] = mapped_column(Text, nullable=False)
    file_type: Mapped[str | None] = mapped_column(Text)
    file_hash: Mapped[str | None] = mapped_column(Text)
    imported_at: Mapped[dt.datetime] = mapped_column(
        DateTime, server_default=func.current_timestamp()
    )
    note: Mapped[str | None] = mapped_column(Text)


class Tag(Base):
    """태그 (정규화)."""

    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(Text, unique=True, nullable=False)


class DocumentTag(Base):
    __tablename__ = "document_tags"

    document_id: Mapped[int] = mapped_column(
        ForeignKey("documents.id"), primary_key=True
    )
    tag_id: Mapped[int] = mapped_column(ForeignKey("tags.id"), primary_key=True)


class TagRule(Base):
    """태그 자동 분류 규칙."""

    __tablename__ = "tag_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    category_id: Mapped[int] = mapped_column(
        ForeignKey("categories.id"), nullable=False
    )
    tag_query: Mapped[str] = mapped_column(Text, nullable=False)
    mode: Mapped[str] = mapped_column(Text, default="suggest")
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime, server_default=func.current_timestamp()
    )


class Suggestion(Base):
    """태그 규칙 연결 제안함 (F21, M6) — 규칙이 만든 '문서→분류 연결' 제안의 저장처."""

    __tablename__ = "suggestions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id"), nullable=False)
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"), nullable=False)
    tag_rule_id: Mapped[int | None] = mapped_column(ForeignKey("tag_rules.id"))
    status: Mapped[str] = mapped_column(Text, default="pending", server_default="pending")
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime, server_default=func.current_timestamp()
    )
    decided_at: Mapped[dt.datetime | None] = mapped_column(DateTime)

    __table_args__ = (
        UniqueConstraint("document_id", "category_id", name="uq_suggestions_document_category"),
    )


class StudyProgress(Base):
    """학습 진도: 분류 맥락별 문서 학습 상태."""

    __tablename__ = "study_progress"

    category_id: Mapped[int] = mapped_column(
        ForeignKey("categories.id"), primary_key=True
    )
    document_id: Mapped[int] = mapped_column(
        ForeignKey("documents.id"), primary_key=True
    )
    status: Mapped[str] = mapped_column(Text, default="not_started")
    completed_at: Mapped[dt.datetime | None] = mapped_column(DateTime)


class ResumePoint(Base):
    """이어하기 위치: 학습 단위(챕터)별 마지막 위치."""

    __tablename__ = "resume_points"

    category_id: Mapped[int] = mapped_column(
        ForeignKey("categories.id"), primary_key=True
    )
    document_id: Mapped[int | None] = mapped_column(ForeignKey("documents.id"))
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime, server_default=func.current_timestamp()
    )


class DocumentRelation(Base):
    """문서 간 관계: 문제↔개념 연결 등."""

    __tablename__ = "document_relations"

    from_document_id: Mapped[int] = mapped_column(
        ForeignKey("documents.id"), primary_key=True
    )
    to_document_id: Mapped[int] = mapped_column(
        ForeignKey("documents.id"), primary_key=True
    )
    relation: Mapped[str] = mapped_column(Text, primary_key=True, default="explains")
    created_by: Mapped[str] = mapped_column(Text, default="manual")
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime, server_default=func.current_timestamp()
    )


class Setting(Base):
    """앱 설정 (키-값)."""

    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(Text, primary_key=True)
    value: Mapped[str | None] = mapped_column(Text)


class Bookmark(Base):
    """북마크 (F29)."""

    __tablename__ = "bookmarks"

    document_id: Mapped[int] = mapped_column(
        ForeignKey("documents.id"), primary_key=True
    )
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime, server_default=func.current_timestamp()
    )
