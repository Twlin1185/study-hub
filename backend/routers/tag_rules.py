"""태그 자동 분류 규칙 라우터 (F21, 설계 §4.9)."""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

import models
from database import get_db
from schemas.tag_rule import (
    ScanResult,
    TagRuleCreate,
    TagRuleOut,
    TagRuleUpdate,
    UnlinkResult,
)
from services import tag_rule_service
from services.tree_utils import category_path

router = APIRouter(prefix="/api/tag-rules", tags=["tag-rules"])


def _rule_out(db: Session, rule: models.TagRule) -> TagRuleOut:
    return TagRuleOut(
        id=rule.id,
        category_id=rule.category_id,
        category_path=category_path(db, rule.category_id),
        tag_query=rule.tag_query,
        mode=rule.mode,
        created_at=rule.created_at,
    )


@router.get("", response_model=List[TagRuleOut])
def list_tag_rules(db: Session = Depends(get_db)) -> List[TagRuleOut]:
    return [_rule_out(db, r) for r in tag_rule_service.list_rules(db)]


@router.post("", response_model=TagRuleOut, status_code=status.HTTP_201_CREATED)
def create_tag_rule(payload: TagRuleCreate, db: Session = Depends(get_db)) -> TagRuleOut:
    rule = tag_rule_service.create_rule(
        db, category_id=payload.category_id, tag_query=payload.tag_query, mode=payload.mode
    )
    return _rule_out(db, rule)


@router.patch("/{rule_id}", response_model=TagRuleOut)
def update_tag_rule(
    rule_id: int, payload: TagRuleUpdate, db: Session = Depends(get_db)
) -> TagRuleOut:
    rule = tag_rule_service.update_rule(
        db,
        rule_id,
        category_id=payload.category_id,
        tag_query=payload.tag_query,
        mode=payload.mode,
    )
    return _rule_out(db, rule)


@router.delete("/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tag_rule(rule_id: int, db: Session = Depends(get_db)) -> None:
    tag_rule_service.delete_rule(db, rule_id)


@router.post("/{rule_id}/scan", response_model=ScanResult)
def scan_tag_rule(rule_id: int, db: Session = Depends(get_db)) -> ScanResult:
    created = tag_rule_service.scan_rule(db, rule_id)
    return ScanResult(created=created)


@router.post("/{rule_id}/unlink", response_model=UnlinkResult)
def unlink_tag_rule(rule_id: int, db: Session = Depends(get_db)) -> UnlinkResult:
    unlinked = tag_rule_service.unlink_rule(db, rule_id)
    return UnlinkResult(unlinked=unlinked)
