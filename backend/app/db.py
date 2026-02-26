from contextlib import contextmanager

from sqlmodel import Session, create_engine

from .config import get_settings

settings = get_settings()
engine = create_engine(settings.database_url, echo=settings.debug, pool_pre_ping=True)


@contextmanager
def session_scope():
    session = Session(engine)
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_session():
    with Session(engine) as session:
        yield session
