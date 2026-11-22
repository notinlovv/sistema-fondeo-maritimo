import math
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


def _calcular_haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calcula la distancia geodésica en metros entre dos coordenadas (Haversine)."""
    r_tierra = 6371000.0  # Radio medio terrestre en metros
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return r_tierra * c


def _punto_en_poligono(lat: float, lon: float, poligono: list) -> bool:
    """
    Determina si el punto (lat, lon) se encuentra dentro de un polígono 2D
    utilizando el algoritmo Ray-Casting (conteo de intersecciones de rayos).
    """
    n = len(poligono)
    if n < 3:
        return True

    dentro = False
    p1_lat, p1_lon = float(poligono[0][0]), float(poligono[0][1])

    for i in range(1, n + 1):
        p2_lat, p2_lon = float(poligono[i % n][0]), float(poligono[i % n][1])
        if min(p1_lat, p2_lat) < lat <= max(p1_lat, p2_lat):
            if p1_lat != p2_lat:
                x_inters = (lat - p1_lat) * (p2_lon - p1_lon) / (p2_lat - p1_lat) + p1_lon
                if lon <= x_inters:
                    dentro = not dentro
        p1_lat, p1_lon = p2_lat, p2_lon

    return dentro


def _evaluar_dentro_zona(
    linea: models.LineaFondeo | None,
    latitud: float | None,
    longitud: float | None,
) -> bool:
    """
    Función pura de validación espacial de la posición del muerto/ancla respecto a la línea:
    1. Si latitud o longitud es None -> True.
    2. Si linea tiene zona_designada con >= 3 vértices -> Ray-Casting (punto en polígono).
    3. Si no hay polígono pero existen lat_muerto y lon_muerto -> distancia Haversine <= radio_tolerancia_m (o 50.0m).
    4. Si la línea no tiene geometría configurada -> True.
    """
    if latitud is None or longitud is None:
        return True
    if linea is None:
        return True

    zona = getattr(linea, "zona_designada", None)
    if isinstance(zona, list) and len(zona) >= 3:
        try:
            return _punto_en_poligono(float(latitud), float(longitud), zona)
        except (ValueError, TypeError, IndexError):
            pass

    lat_m = getattr(linea, "lat_muerto", None)
    lon_m = getattr(linea, "lon_muerto", None)
    if lat_m is not None and lon_m is not None:
        try:
            dist = _calcular_haversine_m(
                float(latitud), float(longitud), float(lat_m), float(lon_m)
            )
            tolerancia = float(getattr(linea, "radio_tolerancia_m", None) or 50.0)
            return dist <= tolerancia
        except (ValueError, TypeError):
            pass

    return True


def _recalcular_estado_linea(db: Session, linea: models.LineaFondeo) -> None:
    """
    Recalcula el estado de la línea considerando únicamente registros activos (eliminado_en is None):
    - Si acumulado >= metros_totales: fija estado = 'completada'.
    - Si acumulado < metros_totales y el estado era 'completada': revierte a 'activa'.
    """
    acumulado = (
        db.query(func.coalesce(func.sum(models.RegistroAvance.metros_avanzados), 0.0))
        .filter(
            models.RegistroAvance.linea_id == linea.id,
            models.RegistroAvance.eliminado_en.is_(None),
        )
        .scalar()
        or 0.0
    )
    metros_totales = float(linea.metros_totales)
    if round(acumulado, 4) >= round(metros_totales, 4):
        linea.estado = "completada"
    elif (
        round(acumulado, 4) < round(metros_totales, 4)
        and linea.estado == "completada"
    ):
        linea.estado = "activa"


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

        elim_val = registro.get("eliminado_en")
        if isinstance(elim_val, datetime):
            elim_str = _normalizar_datetime(elim_val).isoformat()
        else:
            elim_str = str(elim_val) if elim_val is not None else None

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
            "dentro_zona": registro.get("dentro_zona"),
            "eliminado_en": elim_str,
        }

    fecha_val = getattr(registro, "fecha", None)
    if isinstance(fecha_val, datetime):
        fecha_str = _normalizar_datetime(fecha_val).isoformat()
    elif fecha_val is not None:
        fecha_str = str(fecha_val)
    else:
        fecha_str = None

    elim_val = getattr(registro, "eliminado_en", None)
    if isinstance(elim_val, datetime):
        elim_str = _normalizar_datetime(elim_val).isoformat()
    elif elim_val is not None:
        elim_str = str(elim_val)
    else:
        elim_str = None

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
        "dentro_zona": getattr(registro, "dentro_zona", None),
        "eliminado_en": elim_str,
    }


def _son_datos_identicos(
    registro: models.RegistroAvance,
    registro_in: (
        schemas.RegistroAvanceCreate | schemas.RegistroAvanceBase | dict[str, Any]
    ),
) -> bool:
    """Verifica si los datos de negocio recibidos son idénticos a los almacenados."""
    if registro.eliminado_en is not None:
        return False

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
    en la tabla Auditoria y validación geoespacial.
    """

    def __init__(self, db: Session | None = None):
        self.db = db

    @staticmethod
    def validar_datos_registro(
        db: Session,
        registro_in: (
            schemas.RegistroAvanceCreate
            | schemas.RegistroAvanceBase
            | schemas.RegistroAvanceUpdate
            | dict[str, Any]
        ),
        registro_id: str | None = None,
        es_edicion: bool = False,
    ) -> models.LineaFondeo:
        """
        Aplica todas las validaciones de negocio requeridas:
        1. metros_avanzados > 0
        2. fecha no futura respecto a UTC actual
        3. línea de fondeo existente y activa (permite modificar si ya existía el registro)
        4. sumatoria acumulada de registros activos no debe superar metros_totales de la línea
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

        # 3. Validación de existencia de la línea de fondeo
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

        # Determinar si es edición buscando si el registro ya existe en BD
        edicion_efectiva = es_edicion
        if not edicion_efectiva and registro_id:
            reg_existente = (
                db.query(models.RegistroAvance)
                .filter(models.RegistroAvance.id == str(registro_id))
                .first()
            )
            if reg_existente is not None:
                edicion_efectiva = True

        # Solo bloquea creación nueva en líneas pausadas, en mantención o completadas
        if not edicion_efectiva and linea.estado in {
            "pausada",
            "mantencion",
            "completada",
            "fuera_de_posicion",
        }:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="La línea de fondeo no está activa",
            )
        elif not edicion_efectiva and linea.estado != "activa":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="La línea de fondeo no está activa",
            )

        # 4. Validación de sumatoria acumulada de avance en la línea (solo registros activos)
        query_acumulado = db.query(
            func.coalesce(func.sum(models.RegistroAvance.metros_avanzados), 0.0)
        ).filter(
            models.RegistroAvance.linea_id == linea.id,
            models.RegistroAvance.eliminado_en.is_(None),
        )
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
        validaciones de negocio, geovalidación del muerto, persistencia atómica y auditoría.
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

        # Idempotencia: si los datos son idénticos y no está eliminado, retornar sin duplicar ni auditar
        if registro_existente and _son_datos_identicos(registro_existente, registro_in):
            return registro_existente

        # 2. Si no es idéntico (sea nuevo o actualización), aplicar validaciones de negocio
        es_edicion = registro_existente is not None
        linea = cls.validar_datos_registro(
            db=db,
            registro_in=registro_in,
            registro_id=str_uuid,
            es_edicion=es_edicion,
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
        # Geo-validación del muerto / ancla: si es False no arroja error, se almacena como advertencia
        dentro_zona = _evaluar_dentro_zona(linea, latitud, longitud)

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
                registro_existente.dentro_zona = dentro_zona
                registro_existente.eliminado_en = None
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
                    dentro_zona=dentro_zona,
                    eliminado_en=None,
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

            # Recalcular estado de la línea según el total activo
            db.flush()
            _recalcular_estado_linea(db, linea)

            # Manejo de transacción: commit y refresh
            db.commit()
            db.refresh(registro_resultado)
            return registro_resultado

        except Exception:
            db.rollback()
            raise

    @classmethod
    def actualizar_registro(
        cls,
        db: Session,
        registro_id: str,
        datos: schemas.RegistroAvanceUpdate | dict[str, Any],
        usuario: models.Usuario | int,
    ) -> models.RegistroAvance:
        """
        Actualiza parcialmente un registro de avance no eliminado, revalidando reglas de negocio,
        recalculando geovalidación y estado de la línea, y registrando la auditoría.
        """
        str_uuid = str(registro_id)
        registro = (
            db.query(models.RegistroAvance)
            .filter(
                models.RegistroAvance.id == str_uuid,
                models.RegistroAvance.eliminado_en.is_(None),
            )
            .first()
        )
        if not registro:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Registro de avance no encontrado o eliminado",
            )

        id_usuario = usuario.id if hasattr(usuario, "id") else int(usuario)
        valores_antes = _serializar_valores(registro)

        cambios = (
            datos.model_dump(exclude_unset=True)
            if hasattr(datos, "model_dump")
            else datos
        )
        if not cambios:
            return registro

        # Obtener valores consolidados
        nuevo_linea_id = cambios.get("linea_id", registro.linea_id)
        nuevo_metros = (
            cambios.get("metros_avanzados")
            if "metros_avanzados" in cambios
            else registro.metros_avanzados
        )
        nueva_fecha = cambios.get("fecha", registro.fecha)
        nueva_lat = (
            cambios.get("latitud") if "latitud" in cambios else registro.latitud
        )
        nueva_lon = (
            cambios.get("longitud") if "longitud" in cambios else registro.longitud
        )
        nueva_obs = (
            cambios.get("observacion")
            if "observacion" in cambios
            else registro.observacion
        )

        # Revalidar con las reglas de negocio en modo edición
        linea = cls.validar_datos_registro(
            db=db,
            registro_in={
                "linea_id": nuevo_linea_id,
                "metros_avanzados": nuevo_metros,
                "fecha": nueva_fecha,
                "latitud": nueva_lat,
                "longitud": nueva_lon,
                "observacion": nueva_obs,
            },
            registro_id=str_uuid,
            es_edicion=True,
        )

        ahora_utc = datetime.now(timezone.utc)
        registro.linea_id = nuevo_linea_id
        registro.metros_avanzados = float(nuevo_metros)
        if isinstance(nueva_fecha, str):
            registro.fecha = datetime.fromisoformat(nueva_fecha)
        else:
            registro.fecha = nueva_fecha

        registro.latitud = float(nueva_lat) if nueva_lat is not None else None
        registro.longitud = float(nueva_lon) if nueva_lon is not None else None
        registro.observacion = nueva_obs
        registro.dentro_zona = _evaluar_dentro_zona(linea, registro.latitud, registro.longitud)
        registro.sincronizado_en = ahora_utc

        db.flush()
        _recalcular_estado_linea(db, linea)

        valores_despues = _serializar_valores(registro)
        auditoria = models.Auditoria(
            entidad="RegistroAvance",
            entidad_id=str_uuid,
            usuario_id=id_usuario,
            accion="UPDATE",
            valores_antes=valores_antes,
            valores_despues=valores_despues,
            fecha=ahora_utc,
        )
        db.add(auditoria)
        db.commit()
        db.refresh(registro)
        return registro

    @classmethod
    def eliminar_registro(
        cls,
        db: Session,
        registro_id: str,
        usuario: models.Usuario | int,
    ) -> models.RegistroAvance:
        """
        Aplica soft-delete marcando eliminado_en y sincronizado_en, recalcula el estado de la línea
        (reversión a 'activa' si ya no alcanza la meta) y registra la auditoría con acción 'DELETE'.
        """
        str_uuid = str(registro_id)
        registro = (
            db.query(models.RegistroAvance)
            .filter(
                models.RegistroAvance.id == str_uuid,
                models.RegistroAvance.eliminado_en.is_(None),
            )
            .first()
        )
        if not registro:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Registro de avance no encontrado o ya eliminado",
            )

        id_usuario = usuario.id if hasattr(usuario, "id") else int(usuario)
        valores_antes = _serializar_valores(registro)

        ahora_utc = datetime.now(timezone.utc)
        registro.eliminado_en = ahora_utc
        registro.sincronizado_en = ahora_utc

        db.flush()
        linea = (
            db.query(models.LineaFondeo)
            .filter(models.LineaFondeo.id == registro.linea_id)
            .first()
        )
        if linea:
            _recalcular_estado_linea(db, linea)

        valores_despues = _serializar_valores(registro)
        auditoria = models.Auditoria(
            entidad="RegistroAvance",
            entidad_id=str_uuid,
            usuario_id=id_usuario,
            accion="DELETE",
            valores_antes=valores_antes,
            valores_despues=valores_despues,
            fecha=ahora_utc,
        )
        db.add(auditoria)
        db.commit()
        db.refresh(registro)
        return registro

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
        """Obtiene un registro de avance activo por su UUID."""
        return (
            db.query(models.RegistroAvance)
            .filter(
                models.RegistroAvance.id == str(registro_id),
                models.RegistroAvance.eliminado_en.is_(None),
            )
            .first()
        )

    @staticmethod
    def listar_por_linea(db: Session, linea_id: int) -> list[models.RegistroAvance]:
        """Lista todos los registros de avance activos de una línea de fondeo ordenados cronológicamente."""
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
            .filter(
                models.RegistroAvance.linea_id == linea_id,
                models.RegistroAvance.eliminado_en.is_(None),
            )
            .order_by(models.RegistroAvance.fecha.asc())
            .all()
        )

    @staticmethod
    def listar_todos(
        db: Session,
        desde: datetime | None = None,
    ) -> list[models.RegistroAvance]:
        """
        Lista registros de avance:
        - Si 'desde' es None: filtra únicamente registros activos (eliminado_en is None).
        - Si 'desde' se proporciona: incluye registros modificados o eliminados desde esa fecha
          para permitir sincronización diferencial de borrados con clientes móviles.
        """
        query = db.query(models.RegistroAvance)
        if desde is not None:
            desde_utc = _normalizar_datetime(desde)
            query = query.filter(
                (models.RegistroAvance.sincronizado_en >= desde_utc)
                | (models.RegistroAvance.creado_en >= desde_utc)
                | (models.RegistroAvance.eliminado_en >= desde_utc)
            )
        else:
            query = query.filter(models.RegistroAvance.eliminado_en.is_(None))
        return query.order_by(models.RegistroAvance.fecha.asc()).all()

    @staticmethod
    def calcular_metros_acumulados(
        db: Session,
        linea_id: int,
        exclude_registro_id: str | None = None,
    ) -> float:
        """Calcula la sumatoria de metros avanzados de registros activos en una línea."""
        query = db.query(
            func.coalesce(func.sum(models.RegistroAvance.metros_avanzados), 0.0)
        ).filter(
            models.RegistroAvance.linea_id == linea_id,
            models.RegistroAvance.eliminado_en.is_(None),
        )
        if exclude_registro_id:
            query = query.filter(models.RegistroAvance.id != str(exclude_registro_id))
        return float(query.scalar() or 0.0)


# Exportaciones funcionales a nivel de módulo
sincronizar_registro = RegistroService.sincronizar_registro
actualizar_registro = RegistroService.actualizar_registro
eliminar_registro = RegistroService.eliminar_registro
validar_datos_registro = RegistroService.validar_datos_registro
obtener_registro_por_id = RegistroService.obtener_por_id
listar_registros_por_linea = RegistroService.listar_por_linea
listar_registros = RegistroService.listar_todos
calcular_metros_acumulados = RegistroService.calcular_metros_acumulados
_evaluar_dentro_zona = _evaluar_dentro_zona
_recalcular_estado_linea = _recalcular_estado_linea
