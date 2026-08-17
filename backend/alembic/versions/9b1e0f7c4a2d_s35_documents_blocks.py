"""S35 — documents 블록 저장 전환: content_blocks·explanation_blocks·blocks_version 추가
(M34/에디터 v2, 설계 §4.29, 계획서 §6.2 2026-08-18 갱신 — **R42**)

계획서 §6.2 델타: `documents` 테이블에 3컬럼 신설.
- content_blocks TEXT NULL — 앱 중립 블록 JSON 문자열 {version, blocks}. NULL = 미전환 문서.
- explanation_blocks TEXT NULL — 해설 블록 JSON(동일 규약). 전환 판정에는 쓰지 않는다.
- blocks_version INTEGER NULL — content_blocks.version의 컬럼 사본(서버가 채움).
  전환 판정·지연 마이그레이션 SQL 조회의 단일 기준(blocks_version IS NOT NULL = 전환 문서).
기존 행 소급 0(전부 NULL로 남는다 = 미전환으로 태어난다). 인덱스 신설 없음(YAGNI).
SQLite는 컬럼 추가는 일반 ALTER로 가능하나, downgrade(컬럼 제거)는 SQLite가 DROP COLUMN을
직접 지원하지 않는 버전 호환을 위해 batch_alter_table(recreate)을 쓴다(a1c9f3d8e421 전례).

Revision ID: 9b1e0f7c4a2d
Revises: 630a4c2531e8
Create Date: 2026-08-18 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9b1e0f7c4a2d'
down_revision: Union[str, Sequence[str], None] = '630a4c2531e8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('documents', schema=None) as batch_op:
        batch_op.add_column(sa.Column('content_blocks', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('explanation_blocks', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('blocks_version', sa.Integer(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('documents', schema=None, recreate='always') as batch_op:
        batch_op.drop_column('blocks_version')
        batch_op.drop_column('explanation_blocks')
        batch_op.drop_column('content_blocks')
