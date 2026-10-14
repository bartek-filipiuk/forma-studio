from alembic import context
from forma.db import Base, engine

if context.is_offline_mode():
    from forma.config import settings

    context.configure(
        url=settings().database_url, target_metadata=Base.metadata, literal_binds=True
    )
    with context.begin_transaction():
        context.run_migrations()
else:
    with engine.connect() as connection:
        context.configure(
            connection=connection, target_metadata=Base.metadata, compare_type=True
        )
        with context.begin_transaction():
            context.run_migrations()
