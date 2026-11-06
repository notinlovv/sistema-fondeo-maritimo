import os

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import declarative_base, sessionmaker

# Por defecto se usa SQLite local si no existe la variable de entorno
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./data/fondeo.db")

# El argumento check_same_thread=False es necesario en FastAPI con SQLite
# porque FastAPI puede compartir la conexión entre distintos hilos en solicitudes concurrentes.
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args)


# Configuraciones recomendadas para SQLite en producción/concurrencia
@event.listens_for(Engine, "connect")
# SQLAlchemy requires the second callback argument, but this handler doesn't use it.
def set_sqlite_pragma(dbapi_connection, connection_record):
    if DATABASE_URL.startswith("sqlite"):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


# Dependencia para inyectar la sesión de BD en los endpoints de FastAPI
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
