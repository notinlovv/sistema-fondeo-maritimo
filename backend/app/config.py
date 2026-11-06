import os
from pathlib import Path


class Settings:
    """Configuración centralizada del backend cargada desde variables de entorno."""

    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./data/fondeo.db")
    SECRET_KEY: str = os.getenv(
        "SECRET_KEY", "CLAVE_SECRETA_DESARROLLO_NO_USAR_EN_PROD"
    )
    ALGORITHM: str = os.getenv("ALGORITHM", "HS256")
    ACCESS_TOKEN_MINUTES: int = int(os.getenv("ACCESS_TOKEN_MINUTES", "30"))
    REFRESH_TOKEN_DAYS: int = int(os.getenv("REFRESH_TOKEN_DAYS", "14"))
    UPLOAD_DIR: str = os.getenv("UPLOAD_DIR", "./data/archivos")

    def __init__(self) -> None:
        # Asegurar que el directorio de archivos adjuntos exista al iniciar la aplicación
        Path(self.UPLOAD_DIR).mkdir(parents=True, exist_ok=True)

        # Si se usa SQLite local en archivo, asegurar que su directorio padre exista
        if self.DATABASE_URL.startswith("sqlite:///"):
            ruta_db = self.DATABASE_URL.replace("sqlite:///", "", 1)
            directorio_db = os.path.dirname(ruta_db)
            if directorio_db:
                Path(directorio_db).mkdir(parents=True, exist_ok=True)


settings = Settings()

# Constantes exportadas a nivel de módulo para compatibilidad directa
DATABASE_URL = settings.DATABASE_URL
SECRET_KEY = settings.SECRET_KEY
ALGORITHM = settings.ALGORITHM
ACCESS_TOKEN_MINUTES = settings.ACCESS_TOKEN_MINUTES
REFRESH_TOKEN_DAYS = settings.REFRESH_TOKEN_DAYS
UPLOAD_DIR = settings.UPLOAD_DIR
