from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
)
from sqlalchemy.orm import relationship

from app.database import Base


def utc_now():
    return datetime.now(timezone.utc)


class Usuario(Base):
    __tablename__ = "usuarios"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, index=True)
    email = Column(String, unique=True, index=True)
    hash_password = Column(String)
    rol = Column(String, default="supervisor")  # supervisor, gerente, admin
    activo = Column(Boolean, default=True)

    registros = relationship("RegistroAvance", back_populates="usuario")


class LineaFondeo(Base):
    __tablename__ = "lineas_fondeo"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, unique=True, index=True)
    metros_totales = Column(Float, nullable=False)
    fecha_inicio = Column(DateTime, default=utc_now)
    fecha_meta = Column(DateTime)
    estado = Column(String, default="activa")  # activa, completada, pausada

    registros = relationship("RegistroAvance", back_populates="linea")


class RegistroAvance(Base):
    __tablename__ = "registros_avance"

    # UUID como String(36) generado en el móvil para soportar modo offline y compatibilidad PostgreSQL
    id = Column(String(36), primary_key=True, index=True)
    linea_id = Column(Integer, ForeignKey("lineas_fondeo.id"))
    usuario_id = Column(Integer, ForeignKey("usuarios.id"))

    metros_avanzados = Column(Float, nullable=False)
    fecha = Column(DateTime, nullable=False)
    latitud = Column(Float, nullable=True)
    longitud = Column(Float, nullable=True)
    estado = Column(String, default="pendiente")  # pendiente, sincronizado, conflicto
    observacion = Column(String, nullable=True)

    creado_en = Column(DateTime, default=utc_now)
    sincronizado_en = Column(DateTime, default=utc_now, onupdate=utc_now)
    version_esquema = Column(Integer, default=1)

    linea = relationship("LineaFondeo", back_populates="registros")
    usuario = relationship("Usuario", back_populates="registros")
    archivos = relationship("Archivo", back_populates="registro")


class Archivo(Base):
    __tablename__ = "archivos"

    id = Column(Integer, primary_key=True, index=True)
    registro_id = Column(String(36), ForeignKey("registros_avance.id"))
    ruta = Column(String, nullable=False)
    tipo = Column(String)
    tamano = Column(Integer)  # En bytes

    registro = relationship("RegistroAvance", back_populates="archivos")


class Auditoria(Base):
    __tablename__ = "auditoria"

    id = Column(Integer, primary_key=True, index=True)
    entidad = Column(String, index=True)  # ej: "registros_avance"
    entidad_id = Column(String, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"))
    accion = Column(String)  # CREATE, UPDATE, DELETE
    valores_antes = Column(JSON, nullable=True)
    valores_despues = Column(JSON, nullable=True)
    fecha = Column(DateTime, default=utc_now)
