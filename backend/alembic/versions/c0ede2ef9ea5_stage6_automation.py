"""stage 6 automation — suggestions table, category_documents link source columns, FTS5 search

계획서 §6.2 (v0.7) 델타 전부를 담는다:
  - `suggestions` 테이블 신설 (태그 규칙 연결 제안함)
  - `category_documents`에 `linked_by`/`linked_rule_id` 컬럼 추가 (연결 출처 — §11)
  - `documents(title, content, explanation)` FTS5 가상 테이블 + 동기화 트리거 + 기존 문서 백필 (F12)

Revision ID: c0ede2ef9ea5
Revises: 25f8593b9f03
Create Date: 2026-07-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c0ede2ef9ea5'
down_revision: Union[str, Sequence[str], None] = '25f8593b9f03'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # --- suggestions (신규 테이블) ---
    op.create_table(
        'suggestions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('document_id', sa.Integer(), nullable=False),
        sa.Column('category_id', sa.Integer(), nullable=False),
        sa.Column('tag_rule_id', sa.Integer(), nullable=True),
        sa.Column('status', sa.Text(), server_default=sa.text("'pending'"), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.Column('decided_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['category_id'], ['categories.id'], ),
        sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ),
        sa.ForeignKeyConstraint(['tag_rule_id'], ['tag_rules.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('document_id', 'category_id', name='uq_suggestions_document_category'),
    )

    # --- category_documents: 연결 출처 컬럼 추가 (테이블 재생성 — SQLite는 FK 포함 ALTER 불가) ---
    with op.batch_alter_table('category_documents', schema=None, recreate='always') as batch_op:
        batch_op.add_column(
            sa.Column('linked_by', sa.Text(), server_default=sa.text("'manual'"), nullable=False)
        )
        batch_op.add_column(sa.Column('linked_rule_id', sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            'fk_category_documents_linked_rule_id', 'tag_rules', ['linked_rule_id'], ['id']
        )

    # --- FTS5 가상 테이블 (title/content/explanation) + 동기화 트리거 + 기존 문서 백필 ---
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


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP TRIGGER IF EXISTS documents_fts_au")
    op.execute("DROP TRIGGER IF EXISTS documents_fts_ad")
    op.execute("DROP TRIGGER IF EXISTS documents_fts_ai")
    op.execute("DROP TABLE IF EXISTS documents_fts")

    with op.batch_alter_table('category_documents', schema=None, recreate='always') as batch_op:
        batch_op.drop_constraint('fk_category_documents_linked_rule_id', type_='foreignkey')
        batch_op.drop_column('linked_rule_id')
        batch_op.drop_column('linked_by')

    op.drop_table('suggestions')
