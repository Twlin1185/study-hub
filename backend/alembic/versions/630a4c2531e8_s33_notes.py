"""S33 — notes(베타) 테이블 신설: 에디터 v2 드래프트 격리 저장소 (M33, 설계 §4.28)

계획서 §6.2(2026-08-16 추가) DDL을 그대로 반영한다. documents와 완전히 분리된
신규 테이블 — 기존 테이블 diff 0. FTS5 색인 대상이 아니다(가상 테이블·트리거
추가 0 — 설계 §4.28 ⑥). 인덱스 ix_notes_active_updated(is_active, updated_at DESC)는
컬럼별 정렬 방향을 지정해야 해서 op.create_index 대신 op.execute로 계획서 DDL을
그대로 보존한다.

Revision ID: 630a4c2531e8
Revises: a1c9f3d8e421
Create Date: 2026-08-16 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '630a4c2531e8'
down_revision: Union[str, Sequence[str], None] = 'a1c9f3d8e421'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'notes',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('title', sa.Text(), server_default='', nullable=False),
        sa.Column('content_blocks', sa.Text(), nullable=False),
        sa.Column('content', sa.Text(), server_default='', nullable=False),
        sa.Column('blocks_version', sa.Integer(), server_default='1', nullable=False),
        sa.Column('is_active', sa.Integer(), server_default='1', nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.execute(
        "CREATE INDEX ix_notes_active_updated ON notes(is_active, updated_at DESC)"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('notes')
