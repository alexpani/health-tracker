"""Pytest fixtures per i test del backend.

Richiede un PostgreSQL accessibile. Se `TEST_DATABASE_URL` non risponde i test
vengono skippati (non fallisce la CI in ambienti senza DB).
"""
import asyncio
import os

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.models import Base

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://health:health@localhost:5432/health_tracker_test",
)


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="session")
async def engine():
    eng = create_async_engine(TEST_DATABASE_URL, echo=False)
    try:
        async with eng.connect() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
            await conn.commit()
    except Exception as exc:
        await eng.dispose()
        pytest.skip(f"Test database non raggiungibile ({exc!r})")
    try:
        yield eng
    finally:
        async with eng.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
        await eng.dispose()


@pytest_asyncio.fixture
async def db_session(engine) -> AsyncSession:
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as session:
        yield session
        await session.rollback()
        # Pulizia hard fra test — ci sono FK e UNIQUE constraints.
        for table in reversed(Base.metadata.sorted_tables):
            if table.name.startswith("lab_"):
                await session.execute(table.delete())
        await session.commit()
