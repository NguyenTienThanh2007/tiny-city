"""Create account, session, token, cloud-save, and shared rate-limit tables.

Revision ID: 20261013_0001
Revises:
Create Date: 2026-10-13
"""
from alembic import op
import sqlalchemy as sa

revision = '20261013_0001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('users',
        sa.Column('id', sa.String(length=36), primary_key=True),
        sa.Column('display_name', sa.String(length=48), nullable=False),
        sa.Column('email', sa.String(length=320), nullable=False),
        sa.Column('normalized_email', sa.String(length=320), nullable=False),
        sa.Column('password_hash', sa.String(length=512), nullable=False),
        sa.Column('email_verified_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.Column('last_login_at', sa.DateTime(), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='active'),
        sa.UniqueConstraint('normalized_email', name='uq_users_normalized_email'))
    op.create_table('auth_sessions',
        sa.Column('id', sa.String(length=36), primary_key=True),
        sa.Column('user_id', sa.String(length=36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('token_hash', sa.String(length=64), nullable=False),
        sa.Column('csrf_hash', sa.String(length=64), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('last_seen_at', sa.DateTime(), nullable=False),
        sa.Column('revoked_at', sa.DateTime(), nullable=True),
        sa.Column('user_agent', sa.String(length=256), nullable=False, server_default=''),
        sa.UniqueConstraint('token_hash', name='uq_auth_sessions_token_hash'))
    op.create_index('ix_auth_sessions_user_id', 'auth_sessions', ['user_id'])
    op.create_index('ix_auth_sessions_expires_at', 'auth_sessions', ['expires_at'])
    op.create_table('one_time_tokens',
        sa.Column('token_hash', sa.String(length=64), primary_key=True),
        sa.Column('user_id', sa.String(length=36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('purpose', sa.String(length=32), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('consumed_at', sa.DateTime(), nullable=True))
    op.create_index('ix_one_time_tokens_user_id', 'one_time_tokens', ['user_id'])
    op.create_index('ix_one_time_tokens_expires_at', 'one_time_tokens', ['expires_at'])
    op.create_table('user_city_saves',
        sa.Column('id', sa.String(length=36), primary_key=True),
        sa.Column('user_id', sa.String(length=36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(length=64), nullable=False),
        sa.Column('snapshot_json', sa.Text(), nullable=False),
        sa.Column('schema_version', sa.Integer(), nullable=False),
        sa.Column('revision', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False))
    op.create_index('ix_user_city_saves_user_id', 'user_city_saves', ['user_id'])
    op.create_index('ix_user_city_saves_owner_updated', 'user_city_saves', ['user_id', 'updated_at'])
    op.create_table('rate_limit_buckets',
        sa.Column('key_hash', sa.String(length=64), primary_key=True),
        sa.Column('window_started_at', sa.DateTime(), nullable=False),
        sa.Column('count', sa.Integer(), nullable=False))


def downgrade() -> None:
    op.drop_table('rate_limit_buckets')
    op.drop_table('user_city_saves')
    op.drop_table('one_time_tokens')
    op.drop_table('auth_sessions')
    op.drop_table('users')
