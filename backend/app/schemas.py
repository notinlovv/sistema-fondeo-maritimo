from datetime import datetime
from typing import Any

from pydantic import BaseModel, EmailStr, Field


# --- Esquemas de Usuario ---
class UsuarioBase(BaseModel):
    nombre: str
    email: EmailStr
    rol: str = Field(default="supervisor")
    activo: bool = True


class UsuarioCreate(UsuarioBase):
    password: str


class UsuarioResponse(UsuarioBase):
    id: int

    class Config:
        from_attributes = True


# --- Esquemas de Autenticación ---
class Token(BaseModel):
    access_token: str
    token_type: str


class TokenData(BaseModel):
    email: str | None = None
    rol: str | None = None


# --- Esquemas de Línea de Fondeo ---
class LineaFondeoBase(BaseModel):
    nombre: str
    metros_totales: float
    fecha_inicio: datetime | None = None
    fecha_meta: datetime | None = None
    estado: str = "activa"
    descripcion: str | None = None
    lat_inicio: float | None = None
    lon_inicio: float | None = None
    lat_muerto: float | None = None
    lon_muerto: float | None = None
    radio_tolerancia_m: float | None = 50.0
    zona_designada: list | None = None


class LineaFondeoCreate(LineaFondeoBase):
    pass


class LineaFondeoUpdate(BaseModel):
    nombre: str | None = None
    metros_totales: float | None = None
    fecha_inicio: datetime | None = None
    fecha_meta: datetime | None = None
    estado: str | None = None
    descripcion: str | None = None
    lat_inicio: float | None = None
    lon_inicio: float | None = None
    lat_muerto: float | None = None
    lon_muerto: float | None = None
    radio_tolerancia_m: float | None = None
    zona_designada: list | None = None


class LineaFondeoResponse(LineaFondeoBase):
    id: int

    class Config:
        from_attributes = True


# --- Esquemas de Registro de Avance ---
class RegistroAvanceBase(BaseModel):
    linea_id: int
    metros_avanzados: float = Field(
        ..., ge=0, description="Los metros no pueden ser negativos"
    )
    fecha: datetime
    latitud: float | None = None
    longitud: float | None = None
    estado: str = "pendiente"
    observacion: str | None = None
    dentro_zona: bool | None = True


class RegistroAvanceCreate(RegistroAvanceBase):
    # El ID (UUID) es requerido aquí porque se genera en la app móvil offline
    id: str = Field(..., min_length=36, max_length=36)
    version_esquema: int | None = 1


class RegistroAvanceUpdate(BaseModel):
    linea_id: int | None = None
    metros_avanzados: float | None = Field(default=None, ge=0)
    fecha: datetime | None = None
    latitud: float | None = None
    longitud: float | None = None
    observacion: str | None = None


class RegistroAvanceResponse(RegistroAvanceBase):
    id: str
    usuario_id: int
    dentro_zona: bool | None = True
    eliminado_en: datetime | None = None
    creado_en: datetime
    sincronizado_en: datetime
    version_esquema: int

    class Config:
        from_attributes = True


# --- Esquemas de Auditoría ---
class AuditoriaResponse(BaseModel):
    id: int
    entidad: str
    entidad_id: str
    usuario_id: int | None = None
    usuario_nombre: str | None = None
    accion: str
    valores_antes: Any = None
    valores_despues: Any = None
    fecha: datetime

    class Config:
        from_attributes = True


# --- Esquemas de Archivo ---
class ArchivoResponse(BaseModel):
    id: int
    registro_id: str
    ruta: str
    tipo: str
    tamano: int

    class Config:
        from_attributes = True


# --- Esquemas de Dashboard ---
class SerieTemporalPunto(BaseModel):
    fecha: str
    metros_dia: float
    metros_acumulados: float


class DashboardResumenResponse(BaseModel):
    linea_id: int
    nombre_linea: str
    estado_linea: str
    metros_totales: float
    metros_acumulados: float
    metros_restantes: float
    porcentaje_avance: float
    promedio_diario_7d: float
    dias_estimados_termino: int | None = None
    fecha_estimada_termino: datetime | None = None
    alerta_desviacion: bool = False
    severidad_desviacion: str | None = None
    meta_lineal_esperada: float | None = None
    desfase_porcentual: float | None = None
    mensaje_desviacion: str | None = None
    registros_fuera_zona: int = 0
    serie_temporal: list[SerieTemporalPunto] = Field(default_factory=list)

    class Config:
        from_attributes = True
