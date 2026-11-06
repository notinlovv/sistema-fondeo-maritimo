from datetime import datetime

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
    fecha_inicio: datetime
    fecha_meta: datetime | None = None
    estado: str = "activa"


class LineaFondeoCreate(LineaFondeoBase):
    pass


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


class RegistroAvanceCreate(RegistroAvanceBase):
    # El ID (UUID) es requerido aquí porque se genera en la app móvil offline
    id: str = Field(..., min_length=36, max_length=36)
    version_esquema: int | None = 1


class RegistroAvanceResponse(RegistroAvanceBase):
    id: str
    usuario_id: int
    creado_en: datetime
    sincronizado_en: datetime
    version_esquema: int

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
    serie_temporal: list[SerieTemporalPunto] = Field(default_factory=list)

    class Config:
        from_attributes = True
