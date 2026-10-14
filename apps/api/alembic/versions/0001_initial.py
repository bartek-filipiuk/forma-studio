"""Initial durable documents, revisions, jobs and assets."""

from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "projects",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("document", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "revisions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("project_id", sa.String(64), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("document", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("project_id", "revision"),
    )
    op.create_index("ix_revisions_project_id", "revisions", ["project_id"])
    op.create_table(
        "assets",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("name", sa.String(150), nullable=False),
        sa.Column("key", sa.String(250), nullable=False),
        sa.Column("mime", sa.String(100), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
    )
    op.create_table(
        "jobs",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("error", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade():
    for table in ["jobs", "assets", "revisions", "projects"]:
        op.drop_table(table)
