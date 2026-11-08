"""S56 — import_runs·import_run_events 신설: 반입 건 영속·타임라인 (F63 · M40 · R48, 설계 §4.34)

계획서 §6.2(2026-11-08 추가) DDL을 그대로 반영한다. 기존 테이블 diff 0 — 신규 2 테이블 +
인덱스 3. ix_import_runs_active_updated(is_active, updated_at DESC)는 컬럼별 정렬 방향을
지정해야 해서 op.create_index 대신 op.execute로 계획서 DDL을 그대로 보존한다
(630a4c2531e8_s33_notes.py 전례).

Revision ID: d4e7a2b91c56
Revises: 9b1e0f7c4a2d
Create Date: 2026-11-08 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4e7a2b91c56'
down_revision: Union[str, Sequence[str], None] = '9b1e0f7c4a2d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'import_runs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('kind', sa.Text(), nullable=False),
        sa.Column('label', sa.Text(), nullable=False),
        sa.Column('source_name', sa.Text(), nullable=True),
        sa.Column('source_url', sa.Text(), nullable=True),
        sa.Column('category_path', sa.Text(), nullable=True),
        sa.Column('status', sa.Text(), nullable=False),
        sa.Column('job_id', sa.Text(), nullable=True),
        sa.Column('preview_id', sa.Text(), nullable=True),
        sa.Column('split_id', sa.Text(), nullable=True),
        sa.Column('answer_key_id', sa.Text(), nullable=True),
        sa.Column('error_kind', sa.Text(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('summary_json', sa.Text(), nullable=True),
        sa.Column('is_active', sa.Integer(), server_default='1', nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
        sa.Column('committed_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.execute(
        "CREATE INDEX ix_import_runs_active_updated ON import_runs(is_active, updated_at DESC)"
    )
    op.create_index('ix_import_runs_preview', 'import_runs', ['preview_id'], unique=False)

    op.create_table(
        'import_run_events',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('run_id', sa.Integer(), nullable=False),
        sa.Column('at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
        sa.Column('type', sa.Text(), nullable=False),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('detail_json', sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(['run_id'], ['import_runs.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_import_run_events_run', 'import_run_events', ['run_id', 'at'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('import_run_events')
    op.drop_table('import_runs')
