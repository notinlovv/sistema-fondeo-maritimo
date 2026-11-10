import sys
from pathlib import Path

# Asegurar que el directorio raíz del backend esté en sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import auth, models
from app.database import Base, get_db
from app.main import app

# Base de datos SQLite en memoria con StaticPool para aislamiento total
TEST_DATABASE_URL = "sqlite:///:memory:"

test_engine = create_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


@pytest.fixture(autouse=True)
def setup_database():
    """Crea todas las tablas antes de cada prueba y las destruye al finalizar."""
    Base.metadata.create_all(bind=test_engine)
    yield
    Base.metadata.drop_all(bind=test_engine)


@pytest.fixture
def db_session():
    """Inyecta una sesión de base de datos aislada para la prueba."""
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def client(db_session):
    """Cliente HTTP de pruebas con la dependencia get_db sobreescrita."""

    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def usuarios(db_session):
    """Crea usuarios de prueba con roles supervisor, gerente y admin."""
    admin_user = models.Usuario(
        nombre="Administrador Sistema",
        email="admin@fondeo.cl",
        hash_password=auth.get_password_hash("admin123"),
        rol="admin",
        activo=True,
    )
    supervisor_user = models.Usuario(
        nombre="Supervisor Terreno",
        email="supervisor@fondeo.cl",
        hash_password=auth.get_password_hash("supervisor123"),
        rol="supervisor",
        activo=True,
    )
    gerente_user = models.Usuario(
        nombre="Gerente Operaciones",
        email="gerente@fondeo.cl",
        hash_password=auth.get_password_hash("gerente123"),
        rol="gerente",
        activo=True,
    )
    db_session.add_all([admin_user, supervisor_user, gerente_user])
    db_session.commit()
    db_session.refresh(admin_user)
    db_session.refresh(supervisor_user)
    db_session.refresh(gerente_user)

    return {
        "admin": admin_user,
        "supervisor": supervisor_user,
        "gerente": gerente_user,
    }


@pytest.fixture
def auth_headers(usuarios):
    """Genera cabeceras HTTP con Bearer Tokens para cada rol."""
    token_admin = auth.create_access_token(
        data={"sub": usuarios["admin"].email, "rol": usuarios["admin"].rol}
    )
    token_super = auth.create_access_token(
        data={"sub": usuarios["supervisor"].email, "rol": usuarios["supervisor"].rol}
    )
    token_gerente = auth.create_access_token(
        data={"sub": usuarios["gerente"].email, "rol": usuarios["gerente"].rol}
    )

    return {
        "admin": {"Authorization": f"Bearer {token_admin}"},
        "supervisor": {"Authorization": f"Bearer {token_super}"},
        "gerente": {"Authorization": f"Bearer {token_gerente}"},
    }


@pytest.fixture
def linea_piloto(db_session):
    """Crea una línea de fondeo piloto con 1000.0 metros totales."""
    ahora_utc = datetime.now(timezone.utc)
    linea = models.LineaFondeo(
        nombre="Línea Piloto 1",
        metros_totales=1000.0,
        fecha_inicio=ahora_utc - timedelta(days=5),
        fecha_meta=ahora_utc + timedelta(days=5),
        estado="activa",
    )
    db_session.add(linea)
    db_session.commit()
    db_session.refresh(linea)
    return linea
