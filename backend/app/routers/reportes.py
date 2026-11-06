from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app import auth, database, models
from app.services import reporte_service

router = APIRouter(prefix="/reportes", tags=["Reportes"])

ROLES_PERMITIDOS = ["supervisor", "gerente", "admin"]


def require_reportes_access(
    current_user: Annotated[models.Usuario, Depends(auth.get_current_user)],
) -> models.Usuario:
    """Verifica que el usuario tenga rol supervisor, gerente o admin para descargar reportes."""
    if current_user.rol not in ROLES_PERMITIDOS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permisos suficientes para realizar esta acción",
        )
    return current_user


@router.get(
    "/avance.xlsx",
    summary="Descargar reporte consolidado en Excel (.xlsx)",
    response_description="Archivo binario Excel con resumen y bitácora",
)
def descargar_reporte_excel(
    db: Annotated[Session, Depends(database.get_db)],
    current_user: Annotated[models.Usuario, Depends(require_reportes_access)],
    linea_id: Annotated[
        int | None,
        Query(
            description="ID de la línea de fondeo a exportar (si se omite, toma la primera activa)"
        ),
    ] = None,
):
    """
    Genera y descarga en memoria un archivo Excel (.xlsx) con:
    - Hoja 1: Resumen General con metadatos y KPIs operacionales.
    - Hoja 2: Bitácora cronológica completa con coordenadas y observaciones.
    """
    if current_user.rol not in ROLES_PERMITIDOS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permisos suficientes para realizar esta acción",
        )

    linea, _, _, _, _ = reporte_service.ReporteService.obtener_linea_y_registros(
        db=db, linea_id=linea_id
    )
    buffer = reporte_service.generar_excel_avance(db=db, linea_id=linea.id)

    headers = {
        "Content-Disposition": f'attachment; filename="reporte_avance_linea_{linea.id}.xlsx"'
    }
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )


@router.get(
    "/avance.pdf",
    summary="Descargar reporte ejecutivo en PDF (.pdf)",
    response_description="Documento PDF formal de avance y bitácora",
)
def descargar_reporte_pdf(
    db: Annotated[Session, Depends(database.get_db)],
    current_user: Annotated[models.Usuario, Depends(require_reportes_access)],
    linea_id: Annotated[
        int | None,
        Query(
            description="ID de la línea de fondeo a exportar (si se omite, toma la primera activa)"
        ),
    ] = None,
):
    """
    Genera y descarga en memoria un documento PDF formal con:
    - Encabezado institucional y fecha de emisión.
    - Bloque de resumen ejecutivo con métricas de avance y estado.
    - Tabla tabular prolija de la bitácora cronológica con paginación calculada.
    """
    if current_user.rol not in ROLES_PERMITIDOS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permisos suficientes para realizar esta acción",
        )

    linea, _, _, _, _ = reporte_service.ReporteService.obtener_linea_y_registros(
        db=db, linea_id=linea_id
    )
    buffer = reporte_service.generar_pdf_avance(db=db, linea_id=linea.id)

    headers = {
        "Content-Disposition": f'attachment; filename="reporte_avance_linea_{linea.id}.pdf"'
    }
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers=headers,
    )

