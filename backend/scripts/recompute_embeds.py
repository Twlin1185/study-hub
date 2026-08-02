"""임베드 참조 인덱스 전량 재계산 — 관리 스크립트 (S17, F43, 설계 §4.19 ⑥, R20).

`document_relations(relation='embeds', created_by='embed')` 행 전체를 전 문서(is_active
무관) 본문 재파싱으로 재구축한다. 멱등 — 두 번 돌려도 같은 결과. **신규 API로 노출하지
않는다**(§4.19 ⑥ 확정) — 도입 시 1회 백필이나 인덱스가 어긋났을 때의 복구 용도로 이
스크립트를 직접 실행한다(검토 경미-6).

실행 (backend/ 기준):
    backend/.venv/Scripts/python.exe scripts/recompute_embeds.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import func, select  # noqa: E402 - sys.path 보정 뒤에 임포트해야 한다

import models  # noqa: E402
from database import SessionLocal  # noqa: E402
from services import embed_service  # noqa: E402


def main() -> None:
    db = SessionLocal()
    try:
        doc_count = embed_service.recompute_all_embeds(db)
        row_count = db.execute(
            select(func.count()).select_from(models.DocumentRelation).where(
                models.DocumentRelation.relation == "embeds",
                models.DocumentRelation.created_by == "embed",
            )
        ).scalar_one()
        print(f"{doc_count}개 문서, {row_count}행 재구축")
    finally:
        db.close()


if __name__ == "__main__":
    main()
