from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models, schemas


def _normalizar_datetime(dt: datetime | None) -> datetime | None:
    """Normaliza un datetime asegurando que sea consciente de zona horaria (UTC)."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _serializar_valores(
    registro: models.RegistroAvance | schemas.RegistroAvanceCreate | dict[str, Any],
) -> dict[str, Any]:
    """
    Serializa los valores de un registro a un diccionario serializable en JSON
    para almacenar en la tabla de Auditoria.
    """
    if isinstance(registro, dict):
        fecha_val = registro.get("fecha")
        if isinstance(fecha_val, datetime):
            fecha_str = _normalizar_datetime(fecha_val).isoformat()
        else:
            fecha_str = str(fecha_val) if fecha_val is not None else None

        return {
            "linea_id": registro.get("linea_id"),
            "metros_avanzados": (
                float(registro.get("metros_avanzados"))
                if registro.get("metros_avanzados") is not None
                else None
            ),
            "fecha": fecha_str,
            "latitud": (
                float(registro.get("latitud"))
                if registro.get("latitud") is not None
                else None
            ),
            "longitud": (
                float(registro.get("longitud"))
                if registro.get("longitud") is not None
                else None
            ),
            "observacion": registro.get("observacion"),
        }

    fecha_val = getattr(registro, "fecha", None)
    if isinstance(fecha_val, datetime):
        fecha_str = _normalizar_datetime(fecha_val).isoformat()
    elif fecha_val is not None:
        fecha_str = str(fecha_val)
    else:
        fecha_str = None

    metros = getattr(registro, "metros_avanzados", None)
    lat = getattr(registro, "latitud", None)
    lon = getattr(registro, "longitud", None)

    return {
        "linea_id": getattr(registro, "linea_id", None),
        "metros_avanzados": float(metros) if metros is not None else None,
        "fecha": fecha_str,
        "latitud": float(lat) if lat is not None else None,
        "longitud": float(lon) if lon is not None else None,
        "observacion": getattr(registro, "observacion", None),
    }


def _son_datos_identicos(
    registro: models.RegistroAvance,
    registro_in: (
        schemas.RegistroAvanceCreate | schemas.RegistroAvanceBase | dict[str, Any]
    ),
) -> bool:
    """Verifica si los datos de negocio recibidos son idénticos a los almacenados."""
    if isinstance(registro_in, dict):
        linea_id = registro_in.get("linea_id")
        metros_avanzados = registro_in.get("metros_avanzados")
        fecha = registro_in.get("fecha")
        latitud = registro_in.get("latitud")
        longitud = registro_in.get("longitud")
        observacion = registro_in.get("observacion")
    else:
        linea_id = registro_in.linea_id
        metros_avanzados = registro_in.metros_avanzados
        fecha = registro_in.fecha
        latitud = registro_in.latitud
        longitud = registro_in.longitud
        observacion = registro_in.observacion

    if registro.linea_id != linea_id:
        return False

    if abs(float(registro.metros_avanzados) - float(metros_avanzados)) > 1e-5:
        return False

    fecha_reg_utc = _normalizar_datetime(registro.fecha)
    if isinstance(fecha, str):
        try:
            fecha_in_dt = datetime.fromisoformat(fecha)
        except ValueError:
            return False
        fecha_in_utc = _normalizar_datetime(fecha_in_dt)
    else:
        fecha_in_utc = _normalizar_datetime(fecha)

    if fecha_reg_utc is not None and fecha_in_utc is not None:
        if abs((fecha_reg_utc - fecha_in_utc).total_seconds()) > 0.5:
            return False
    elif (fecha_reg_utc is None) != (fecha_in_utc is None):
        return False

    if (registro.latitud is None) != (latitud is None):
        return False
    if (
        registro.latitud is not None
        and latitud is not None
        and abs(float(registro.latitud) - float(latitud)) > 1e-6
    ):
        return False

    if (registro.longitud is None) != (longitud is None):
        return False
    if (
        registro.longitud is not None
        and longitud is not None
        and abs(float(registro.longitud) - float(longitud)) > 1e-6
    ):
        return False

    obs_existente = registro.observacion or ""
    obs_nueva = observacion or ""
    return obs_existente == obs_nueva


class RegistroService:
    """
    Servicio encargado de aislar la lógica de negocio, validaciones y persistencia
    de los registros de avance de líneas de fondeo, incluyendo trazabilidad obligatoria
    en la tabla Auditoria.
    """

    def __init__(self, db: Session | None = None):
        self.db = db

    @staticmethod
    def validar_datos_registro(
        db: Session,
        registro_in: (
            schemas.RegistroAvanceCreate | schemas.RegistroAvanceBase | dict[str, Any]
        ),
        registro_id: str | None = None,
    ) -> models.LineaFondeo:
        """
        Aplica todas las validaciones de negocio requeridas:
        1. metros_avanzados > 0
        2. fecha no futura respecto a UTC actual
        3. línea de fondeo existente y activa
        4. sumatoria acumulada no debe superar metros_totales de la línea
        """
        if isinstance(registro_in, dict):
            metros_avanzados = registro_in.get("metros_avanzados")
            fecha = registro_in.get("fecha")
            linea_id = registro_in.get("linea_id")
        else:
            metros_avanzados = registro_in.metros_avanzados
            fecha = registro_in.fecha
            linea_id = registro_in.linea_id

        # 1. Validación de metros avanzados estrictamente mayores a 0
        if metros_avanzados is None or float(metros_avanzados) <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Los metros avanzados deben ser mayores a cero",
            )

        # 2. Validación de fecha no futura respecto a la hora UTC actual
        ahora_utc = datetime.now(timezone.utc)
        if isinstance(fecha, str):
            try:
                fecha_dt = datetime.fromisoformat(fecha)
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Formato de fecha inválido",
                )
        else:
            fecha_dt = fecha

        fecha_utc = _normalizar_datetime(fecha_dt)
        if fecha_utc is not None and fecha_utc > ahora_utc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="La fecha del registro no puede ser futura",
            )

        # 3. Validación de existencia y estado activo de la línea de fondeo
        linea = (
            db.query(models.LineaFondeo)
            .filter(models.LineaFondeo.id == linea_id)
            .first()
        )
        if not linea:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="La línea de fondeo no existe",
            )

        if linea.estado != "activa":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="La línea de fondeo no está activa",
            )

        # 4. Validación de sumatoria acumulada de avance en la línea
        query_acumulado = db.query(
            func.coalesce(func.sum(models.RegistroAvance.metros_avanzados), 0.0)
        ).filter(models.RegistroAvance.linea_id == linea.id)
        if registro_id:
            query_acumulado = query_acumulado.filter(
                models.RegistroAvance.id != str(registro_id)
            )

        metros_acumulados_previos = float(query_acumulado.scalar() or 0.0)
        metros_nuevos = float(metros_avanzados)
        metros_totales = float(linea.metros_totales)

        if round(metros_acumulados_previos + metros_nuevos, 4) > round(
            metros_totales, 4
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El avance acumulado supera los metros totales programados para la línea",
            )

        return linea

    @classmethod
    def sincronizar_registro(
        cls,
        db: Session,
        registro_id: str,
        registro_in: schemas.RegistroAvanceCreate | dict[str, Any],
        usuario_actual_id: int | models.Usuario | None = None,
        *,
        usuario_id: int | models.Usuario | None = None,
        current_user: int | models.Usuario | None = None,
    ) -> models.RegistroAvance:
        """
        Sincroniza un avance de fondeo (PUT /registros/{uuid}) garantizando idempotencia,
        validaciones de negocio, persistencia atómica y auditoría obligatoria.
        """
        # Resolver ID de usuario actual
        user_source = (
            usuario_actual_id
            if usuario_actual_id is not None
            else (usuario_id if usuario_id is not None else current_user)
        )
        if hasattr(user_source, "id"):
            id_usuario = user_source.id
        elif user_source is not None:
            id_usuario = int(user_source)
        else:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Usuario no autenticado o no proporcionado",
            )

        # Validar consistencia si se provee ID en el cuerpo
        body_id = (
            registro_in.get("id")
            if isinstance(registro_in, dict)
            else getattr(registro_in, "id", None)
        )
        if body_id and str(body_id) != str(registro_id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="UUID mismatch",
            )

        str_uuid = str(registro_id)

        # 1. Buscar si el registro ya existe en la base de datos
        registro_existente = (
            db.query(models.RegistroAvance)
            .filter(models.RegistroAvance.id == str_uuid)
            .first()
        )

        # Idempotencia: si los datos son idénticos, retornar sin duplicar ni auditar
        if registro_existente and _son_datos_identicos(registro_existente, registro_in):
            return registro_existente

        # 2. Si no es idéntico (sea nuevo o actualización), aplicar validaciones de negocio
        linea = cls.validar_datos_registro(
            db=db, registro_in=registro_in, registro_id=str_uuid
        )

        # Convertir a valores estándar
        if isinstance(registro_in, dict):
            linea_id = registro_in.get("linea_id")
            metros_avanzados = float(registro_in.get("metros_avanzados"))
            fecha_raw = registro_in.get("fecha")
            fecha = (
                datetime.fromisoformat(fecha_raw)
                if isinstance(fecha_raw, str)
                else fecha_raw
            )
            latitud = (
                float(registro_in.get("latitud"))
                if registro_in.get("latitud") is not None
                else None
            )
            longitud = (
                float(registro_in.get("longitud"))
                if registro_in.get("longitud") is not None
                else None
            )
            observacion = registro_in.get("observacion")
            version_esquema = registro_in.get("version_esquema", 1) or 1
        else:
            linea_id = registro_in.linea_id
            metros_avanzados = float(registro_in.metros_avanzados)
            fecha = registro_in.fecha
            latitud = (
                float(registro_in.latitud) if registro_in.latitud is not None else None
            )
            longitud = (
                float(registro_in.longitud)
                if registro_in.longitud is not None
                else None
            )
            observacion = registro_in.observacion
            version_esquema = getattr(registro_in, "version_esquema", 1) or 1

        ahora_utc = datetime.now(timezone.utc)

        try:
            if registro_existente:
                # Caso UPDATE
                valores_antes = _serializar_valores(registro_existente)

                # Actualizar campos permitidos
                registro_existente.linea_id = linea_id
                registro_existente.metros_avanzados = metros_avanzados
                registro_existente.fecha = fecha
                registro_existente.latitud = latitud
                registro_existente.longitud = longitud
                registro_existente.observacion = observacion
                registro_existente.version_esquema = version_esquema
                registro_existente.estado = "sincronizado"
                registro_existente.sincronizado_en = ahora_utc

                valores_despues = _serializar_valores(registro_existente)

                # Registrar auditoria UPDATE
                auditoria = models.Auditoria(
                    entidad="RegistroAvance",
                    entidad_id=registro_existente.id,
                    usuario_id=id_usuario,
                    accion="UPDATE",
                    valores_antes=valores_antes,
                    valores_despues=valores_despues,
                    fecha=ahora_utc,
                )
                db.add(auditoria)
                registro_resultado = registro_existente
            else:
                # Caso INSERT
                nuevo_registro = models.RegistroAvance(
                    id=str_uuid,
                    linea_id=linea_id,
                    usuario_id=id_usuario,
                    metros_avanzados=metros_avanzados,
                    fecha=fecha,
                    latitud=latitud,
                    longitud=longitud,
                    estado="sincronizado",
                    observacion=observacion,
                    creado_en=ahora_utc,
                    sincronizado_en=ahora_utc,
                    version_esquema=version_esquema,
                )
                db.add(nuevo_registro)

                valores_despues = _serializar_valores(nuevo_registro)

                # Registrar auditoria INSERT
                auditoria = models.Auditoria(
                    entidad="RegistroAvance",
                    entidad_id=nuevo_registro.id,
                    usuario_id=id_usuario,
                    accion="INSERT",
                    valores_antes=None,
                    valores_despues=valores_despues,
                    fecha=ahora_utc,
                )
                db.add(auditoria)
                registro_resultado = nuevo_registro

            # 3. Actualizar estado de la línea si se completaron los metros totales
            query_total = db.query(
                func.coalesce(func.sum(models.RegistroAvance.metros_avanzados), 0.0)
            ).filter(
                models.RegistroAvance.linea_id == linea.id,
                models.RegistroAvance.id != str_uuid,
            )
            acumulado_otros = float(query_total.scalar() or 0.0)
            acumulado_total = round(acumulado_otros + metros_avanzados, 4)

            if acumulado_total >= round(float(linea.metros_totales), 4):
                linea.estado = "completada"

            # 4. Manejo de transacción: commit y refresh
            db.commit()
            db.refresh(registro_resultado)
            return registro_resultado

        except Exception:
            db.rollback()
            raise

    def sincronizar(
        self,
        registro_id: str,
        registro_in: schemas.RegistroAvanceCreate | dict[str, Any],
        usuario_actual_id: int | models.Usuario | None = None,
        **kwargs,
    ) -> models.RegistroAvance:
        """Método de instancia que reutiliza la sesión configurada."""
        if self.db is None:
            raise ValueError(
                "No se ha configurado una sesión de base de datos en la instancia de RegistroService"
            )
        return self.sincronizar_registro(
            db=self.db,
            registro_id=registro_id,
            registro_in=registro_in,
            usuario_actual_id=usuario_actual_id,
            **kwargs,
        )

    @staticmethod
    def obtener_por_id(db: Session, registro_id: str) -> models.RegistroAvance | None:
        """Obtiene un registro de avance por su UUID."""
        return (
            db.query(models.RegistroAvance)
            .filter(models.RegistroAvance.id == str(registro_id))
            .first()
        )

    @staticmethod
    def listar_por_linea(db: Session, linea_id: int) -> list[models.RegistroAvance]:
        """Lista todos los registros de avance de una línea de fondeo ordenados cronológicamente."""
        linea = (
            db.query(models.LineaFondeo)
            .filter(models.LineaFondeo.id == linea_id)
            .first()
        )
        if not linea:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="La línea de fondeo no existe",
            )
        return (
            db.query(models.RegistroAvance)
            .filter(models.RegistroAvance.linea_id == linea_id)
            .order_by(models.RegistroAvance.fecha.asc())
            .all()
        )

    @staticmethod
    def listar_todos(
        db: Session,
        desde: datetime | None = None,
    ) -> list[models.RegistroAvance]:
        """
        Lista todos los registros de avance con soporte opcional de sincronización
        diferencial mediante el parámetro `desde`.
        """
        query = db.query(models.RegistroAvance)
        if desde is not None:
            desde_utc = _normalizar_datetime(desde)
            query = query.filter(
                (models.RegistroAvance.sincronizado_en >= desde_utc)
                | (models.RegistroAvance.creado_en >= desde_utc)
            )
        return query.order_by(models.RegistroAvance.fecha.asc()).all()

    @staticmethod
    def calcular_metros_acumulados(
        db: Session,
        linea_id: int,
        exclude_registro_id: str | None = None,
    ) -> float:
        """Calcula la sumatoria de metros avanzados de una línea de fondeo."""
        query = db.query(
            func.coalesce(func.sum(models.RegistroAvance.metros_avanzados), 0.0)
        ).filter(models.RegistroAvance.linea_id == linea_id)
        if exclude_registro_id:
            query = query.filter(models.RegistroAvance.id != str(exclude_registro_id))
        return float(query.scalar() or 0.0)


# Exportaciones funcionales a nivel de módulo
sincronizar_registro = RegistroService.sincronizar_registro
validar_datos_registro = RegistroService.validar_datos_registro
obtener_registro_por_id = RegistroService.obtener_por_id
listar_registros_por_linea = RegistroService.listar_por_linea
listar_registros = RegistroService.listar_todos
calcular_metros_acumulados = RegistroService.calcular_metros_acumulados
