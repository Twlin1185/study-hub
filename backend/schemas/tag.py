from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class TagOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    usage_count: int = 0


class TagMergeRequest(BaseModel):
    """오타 태그 병합 — from_id의 문서 태그를 to_id로 옮기고 from_id 태그는 삭제한다."""

    from_id: int
    to_id: int


class TagMergeResult(BaseModel):
    merged_documents: int  # 태그가 재배정된 문서 수 (중복 제외)
    removed_tag_id: int
