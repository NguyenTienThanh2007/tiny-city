"""SQLAlchemy engine/session lifecycle. Schema creation is handled only by Alembic."""
from collections.abc import Generator

from fastapi import Request
from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool


def create_database_engine(url: str) -> Engine:
    kwargs: dict = {'pool_pre_ping': True}
    if url.startswith('sqlite:'):
        kwargs['connect_args'] = {'check_same_thread': False, 'timeout': 15}
        if url in ('sqlite://', 'sqlite:///:memory:'):
            kwargs['poolclass'] = StaticPool
    engine = create_engine(url, **kwargs)
    if url.startswith('sqlite:'):
        @event.listens_for(engine, 'connect')
        def enable_sqlite_foreign_keys(connection, _record):
            cursor = connection.cursor()
            cursor.execute('PRAGMA foreign_keys=ON')
            cursor.close()
    return engine


def create_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db(request: Request) -> Generator[Session, None, None]:
    session = request.app.state.session_factory()
    try:
        yield session
    finally:
        session.close()
