"""Single-owner access, revocable sessions and persistent login throttling."""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("owner",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("username", sa.String(100), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.CheckConstraint("id = 'owner'", name="single_owner"))
    op.create_table("auth_sessions",
        sa.Column("token_hash", sa.String(64), primary_key=True),
        sa.Column("owner_id", sa.String(64), nullable=False),
        sa.Column("csrf_token", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_auth_sessions_expires_at", "auth_sessions", ["expires_at"])
    op.create_table("login_limits",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("window_end", sa.DateTime(timezone=True), nullable=False))
    # All pre-auth documents belong to this installation's sole owner. There is
    # no public registration, second account or unclaimed-data adoption endpoint.
    for table in ("projects", "revisions", "assets", "jobs"):
        op.add_column(table, sa.Column("owner_id", sa.String(64), nullable=False, server_default="owner"))
        op.create_index(f"ix_{table}_owner_id", table, ["owner_id"])


def downgrade():
    for table in ("jobs", "assets", "revisions", "projects"):
        op.drop_index(f"ix_{table}_owner_id", table_name=table)
        op.drop_column(table, "owner_id")
    for table in ("login_limits", "auth_sessions", "owner"):
        op.drop_table(table)
