from datetime import UTC, datetime

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from tiny_city_api.models import User


def test_account_migration_runs_from_empty_database_and_repeated_upgrade_preserves_data(tmp_path, monkeypatch):
    database_file = tmp_path / 'account-migration.sqlite3'
    monkeypatch.setenv('DATABASE_URL', f'sqlite:///{database_file.as_posix()}')
    monkeypatch.setenv('APP_ENV', 'test')
    alembic = Config('alembic.ini')
    command.upgrade(alembic, 'head')

    engine = create_engine(f'sqlite:///{database_file.as_posix()}')
    now = datetime.now(UTC).replace(tzinfo=None)
    with Session(engine) as session:
        session.add(User(id='migration-user', display_name='Migration', email='migration@example.com',
            normalized_email='migration@example.com', password_hash='$argon2id$test-hash',
            email_verified_at=now, created_at=now, updated_at=now, status='active'))
        session.commit()

    command.upgrade(alembic, 'head')
    with Session(engine) as session:
        user = session.scalar(select(User).where(User.normalized_email == 'migration@example.com'))
        assert user is not None
        assert user.display_name == 'Migration'
    engine.dispose()
