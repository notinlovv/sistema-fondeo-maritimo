from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import auth, database, models, schemas

router = APIRouter(prefix="/lineas", tags=["Líneas de Fondeo"])


def _serializar_linea(linea: models.LineaFondeo) -> dict:
    """Convierte una instancia de LineaFondeo en un diccionario serializable a JSON para auditoría."""
    return {
        "id": linea.id,
        "nombre": linea.nombre,
        "metros_totales": linea.metros_totales,
        "fecha_inicio": linea.fecha_inicio.isoformat() if linea.fecha_inicio else None,
        "fecha_meta": linea.fecha_meta.isoformat() if linea.fecha_meta else None,
        "estado": linea.estado,
    }


@router.get(
    "/",
    response_model=list[schemas.LineaFondeoResponse],
    dependencies=[Depends(auth.get_current_user)],
)
def listar_lineas(
    db: Session = Depends(database.get_db),
):
    """Lista todas las líneas de fondeo registradas."""
    return db.query(models.LineaFondeo).order_by(models.LineaFondeo.id.asc()).all()


@router.get(
    "/{linea_id}",
    response_model=schemas.LineaFondeoResponse,
    dependencies=[Depends(auth.get_current_user)],
)
def obtener_linea(
    linea_id: int,
    db: Session = Depends(database.get_db),
):
    """Obtiene el detalle de una línea de fondeo por su ID."""
    linea = (
        db.query(models.LineaFondeo).filter(models.LineaFondeo.id == linea_id).first()
    )
    if not linea:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Línea de fondeo con ID {linea_id} no encontrada",
        )
    return linea


@router.post(
    "/",
    response_model=schemas.LineaFondeoResponse,
    status_code=status.HTTP_201_CREATED,
)
def crear_linea(
    linea_in: schemas.LineaFondeoCreate,
    db: Session = Depends(database.get_db),
    current_user: models.Usuario = Depends(auth.require_role(["admin", "gerente"])),
):
    """Crea una nueva línea de fondeo (restringido a roles admin y gerente)."""
    existente = (
        db.query(models.LineaFondeo)
        .filter(models.LineaFondeo.nombre == linea_in.nombre)
        .first()
    )
    if existente:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Ya existe una línea de fondeo con el nombre '{linea_in.nombre}'",
        )

    datos = linea_in.model_dump(exclude_none=True)
    nueva_linea = models.LineaFondeo(**datos)
    db.add(nueva_linea)
    db.flush()

    auditoria = models.Auditoria(
        entidad="lineas_fondeo",
        entidad_id=str(nueva_linea.id),
        usuario_id=current_user.id,
        accion="CREATE",
        valores_antes=None,
        valores_despues=_serializar_linea(nueva_linea),
        fecha=models.utc_now(),
    )
    db.add(auditoria)
    db.commit()
    db.refresh(nueva_linea)
    return nueva_linea


@router.patch("/{linea_id}", response_model=schemas.LineaFondeoResponse)
def actualizar_linea(
    linea_id: int,
    linea_in: schemas.LineaFondeoUpdate,
    db: Session = Depends(database.get_db),
    current_user: models.Usuario = Depends(auth.require_role(["admin", "gerente"])),
):
    """Actualiza parcialmente una línea de fondeo (restringido a roles admin y gerente)."""
    linea = (
        db.query(models.LineaFondeo).filter(models.LineaFondeo.id == linea_id).first()
    )
    if not linea:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Línea de fondeo con ID {linea_id} no encontrada",
        )

    cambios = linea_in.model_dump(exclude_unset=True)
    if not cambios:
        return linea

    if "nombre" in cambios and cambios["nombre"] != linea.nombre:
        duplicada = (
            db.query(models.LineaFondeo)
            .filter(
                models.LineaFondeo.nombre == cambios["nombre"],
                models.LineaFondeo.id != linea_id,
            )
            .first()
        )
        if duplicada:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Ya existe otra línea de fondeo con el nombre '{cambios['nombre']}'",
            )

    if "metros_totales" in cambios and cambios["metros_totales"] is not None:
        metros_acumulados = (
            db.query(
                func.coalesce(func.sum(models.RegistroAvance.metros_avanzados), 0.0)
            )
            .filter(models.RegistroAvance.linea_id == linea_id)
            .scalar()
            or 0.0
        )
        if cambios["metros_totales"] < metros_acumulados:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Los metros totales ({cambios['metros_totales']} m) no pueden ser "
                    f"menores al avance ya acumulado ({metros_acumulados} m)"
                ),
            )

    valores_antes = _serializar_linea(linea)

    for campo, valor in cambios.items():
        setattr(linea, campo, valor)

    db.flush()
    auditoria = models.Auditoria(
        entidad="lineas_fondeo",
        entidad_id=str(linea.id),
        usuario_id=current_user.id,
        accion="UPDATE",
        valores_antes=valores_antes,
        valores_despues=_serializar_linea(linea),
        fecha=models.utc_now(),
    )
    db.add(auditoria)
    db.commit()
    db.refresh(linea)
    return linea