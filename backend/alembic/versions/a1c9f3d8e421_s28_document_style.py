"""S28 — 문서별 스타일: documents.style TEXT NULL 추가 (M27/F53, 설계 §4.26 [S28])

계획서 §6.2 (2026-08-13 갱신) 델타: `documents` 테이블에 `style` 컬럼 신설.
- nullable, 기본 NULL — 기존 행 소급 0(전부 NULL로 남는다 = 전역 상속 상태).
- 저장 값은 서버 화이트리스트를 통과한 JSON 문자열({font?, size?, bg?})뿐이나, 컬럼
  자체는 SQLite 관례대로 TEXT(검증은 애플리케이션 계층 — schemas/document.py).
- SQLite는 컬럼 추가는 일반 ALTER로 가능하나, downgrade(컬럼 제거)는 SQLite가 DROP
  COLUMN을 직접 지원하지 않는 버전 호환을 위해 batch_alter_table(recreate)을 쓴다.

Revision ID: a1c9f3d8e421
Revises: 70c7e667765f
Create Date: 2026-08-13 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1c9f3d8e421'
down_revision: Union[str, Sequence[str], None] = '70c7e667765f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('documents', schema=None) as batch_op:
        batch_op.add_column(sa.Column('style', sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('documents', schema=None, recreate='always') as batch_op:
        batch_op.drop_column('style')
