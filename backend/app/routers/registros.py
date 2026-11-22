import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app import auth, database, models, schemas
from app.services import registro_service

router = APIRouter(prefix="/registros", tags=["Registros de Avance"])

ROLES_ESCRITURA = ["supervisor", "admin"]
ROLES_LECTURA = ["supervisor", "gerente", "admin"]


def require_escritura_avance(
    current_user: Annotated[models.Usuario, Depends(auth.get_current_user)],
) -> models.Usuario:
    """Verifica que el usuario tenga rol supervisor o admin para registrar avances."""
    if current_user.rol not in ROLES_ESCRITURA:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tiene permisos para registrar avances",
        )
    return current_user


def require_lectura_avance(
    current_user: Annotated[models.Usuario, Depends(auth.get_current_user)],
) -> models.Usuario:
    """Verifica que el usuario tenga rol supervisor, gerente o admin para consultar."""
    if current_user.rol not in ROLES_LECTURA:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permisos suficientes para realizar esta acción",
        )
    return current_user


def validar_uuid_v4(identificador: str) -> str:
    """Valida que el identificador tenga formato UUID válido."""
    try:
        uuid_obj = uuid.UUID(str(identificador))
        return str(uuid_obj)
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El formato del UUID no es válido",
        )


@router.put(
    "/{uuid}",
    response_model=schemas.RegistroAvanceResponse,
    status_code=status.HTTP_200_OK,
    summary="Sincronizar o registrar un avance de fondeo (Idempotente)",
)
def sincronizar_registro(
    uuid: str,
    registro_in: schemas.RegistroAvanceCreate,
    db: Annotated[Session, Depends(database.get_db)],
    current_user: Annotated[models.Usuario, Depends(require_escritura_avance)],
):
    """
    Registra o sincroniza un avance de fondeo de manera idempotente:
    - Solo supervisores y administradores pueden registrar avances.
    - Delega validaciones de negocio, persistencia atómica y auditoría a RegistroService.
    """
    uuid_str = validar_uuid_v4(uuid)

    if current_user.rol not in ROLES_ESCRITURA:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tiene permisos para registrar avances",
        )

    return registro_service.sincronizar_registro(
        db=db,
        registro_id=uuid_str,
        registro_in=registro_in,
        usuario_actual_id=current_user,
    )


@router.get(
    "",
    response_model=list[schemas.RegistroAvanceResponse],
    summary="Listar avances con soporte para sincronización diferencial",
)
@router.get(
    "/",
    response_model=list[schemas.RegistroAvanceResponse],
    include_in_schema=False,
)
def listar_registros(
    db: Annotated[Session, Depends(database.get_db)],
    current_user: Annotated[models.Usuario, Depends(require_lectura_avance)],
    desde: Annotated[
        str | None,
        Query(
            description="Timestamp ISO para descargar únicamente cambios desde dicha fecha"
        ),
    ] = None,
):
    """
    Retorna la lista de avances de fondeo.
    Si se proporciona el parámetro `desde`, retorna solo los registros creados,
    actualizados o eliminados con fecha mayor o igual a dicho timestamp.
    """
    if current_user.rol not in ROLES_LECTURA:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permisos suficientes para realizar esta acción",
        )

    desde_dt: datetime | None = None
    if desde is not None:
        try:
            # Reemplazar espacio por '+' si la URL desescapó el timezone offset
            desde_dt = datetime.fromisoformat(desde.replace(" ", "+"))
        except (ValueError, TypeError):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Formato de fecha inválido para 'desde'",
            )

    return registro_service.listar_registros(db=db, desde=desde_dt)


@router.get(
    "/linea/{linea_id}",
    response_model=list[schemas.RegistroAvanceResponse],
    summary="Listar registros asociados a una línea ordenados cronológicamente",
)
def listar_registros_por_linea(
    linea_id: int,
    db: Annotated[Session, Depends(database.get_db)],
    current_user: Annotated[models.Usuario, Depends(require_lectura_avance)],
):
    """
    Consulta los registros de avance de una línea específica ordenados cronológicamente
    por su fecha de registro.
    """
    if current_user.rol not in ROLES_LECTURA:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permisos suficientes para realizar esta acción",
        )

    return registro_service.listar_registros_por_linea(db=db, linea_id=linea_id)


@router.get(
    "/{uuid}",
    response_model=schemas.RegistroAvanceResponse,
    summary="Obtener un registro de avance por su UUID",
)
def obtener_registro(
    uuid: str,
    db: Annotated[Session, Depends(database.get_db)],
    current_user: Annotated[models.Usuario, Depends(require_lectura_avance)],
):
    """Consulta un registro de avance individual por su UUID."""
    uuid_str = validar_uuid_v4(uuid)

    if current_user.rol not in ROLES_LECTURA:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permisos suficientes para realizar esta acción",
        )

    registro = registro_service.obtener_registro_por_id(db=db, registro_id=uuid_str)
    if not registro:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Registro no encontrado",
        )
    return registro


@router.patch(
    "/{uuid}",
    response_model=schemas.RegistroAvanceResponse,
    summary="Actualizar parcialmente un registro de avance",
)
def actualizar_registro(
    uuid: str,
    registro_in: schemas.RegistroAvanceUpdate,
    db: Annotated[Session, Depends(database.get_db)],
    current_user: Annotated[
        models.Usuario,
        Depends(auth.require_role(["supervisor", "gerente", "admin"])),
    ],
):
    """Actualiza parcialmente un registro de avance existente y recalcula reglas de negocio y estado."""
    uuid_str = validar_uuid_v4(uuid)
    return registro_service.actualizar_registro(
        db=db,
        registro_id=uuid_str,
        datos=registro_in,
        usuario=current_user,
    )


@router.delete(
    "/{uuid}",
    response_model=schemas.RegistroAvanceResponse,
    summary="Eliminar (soft-delete) un registro de avance",
)
def eliminar_registro(
    uuid: str,
    db: Annotated[Session, Depends(database.get_db)],
    current_user: Annotated[
        models.Usuario,
        Depends(auth.require_role(["supervisor", "gerente", "admin"])),
    ],
):
    """Marca un registro de avance como eliminado (soft-delete) y recalcula el estado de la línea."""
    uuid_str = validar_uuid_v4(uuid)
    return registro_service.eliminar_registro(
        db=db,
        registro_id=uuid_str,
        usuario=current_user,
    )


@router.get(
    "/{uuid}/auditoria",
    response_model=list[schemas.AuditoriaResponse],
    summary="Consultar historial de auditoría de un registro",
)
def consultar_auditoria_registro(
    uuid: str,
    db: Annotated[Session, Depends(database.get_db)],
    current_user: Annotated[
        models.Usuario,
        Depends(auth.require_role(["supervisor", "gerente", "admin"])),
    ],
):
    """Consulta el historial de auditoría de un registro de avance ordenado por fecha descendente."""
    uuid_str = validar_uuid_v4(uuid)
    rows = (
        db.query(models.Auditoria, models.Usuario.nombre)
        .outerjoin(models.Usuario, models.Auditoria.usuario_id == models.Usuario.id)
        .filter(
            models.Auditoria.entidad.in_(["RegistroAvance", "registros_avance"]),
            models.Auditoria.entidad_id == uuid_str,
        )
        .order_by(models.Auditoria.fecha.desc())
        .all()
    )
    return [
        schemas.AuditoriaResponse(
            id=audit.id,
            entidad=audit.entidad,
            entidad_id=audit.entidad_id,
            usuario_id=audit.usuario_id,
            usuario_nombre=nombre_usuario,
            accion=audit.accion,
            valores_antes=audit.valores_antes,
            valores_despues=audit.valores_despues,
            fecha=audit.fecha,
        )
        for audit, nombre_usuario in rows
    ]
