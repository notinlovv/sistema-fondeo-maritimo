from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app import auth, database, models, schemas
from app.services import dashboard_service

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])

ROLES_PERMITIDOS = ["gerente", "admin", "supervisor"]


def require_dashboard_access(
    current_user: Annotated[models.Usuario, Depends(auth.get_current_user)],
) -> models.Usuario:
    """Valida que el usuario tenga rol gerente, admin o supervisor para acceder al dashboard."""
    if current_user.rol not in ROLES_PERMITIDOS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permisos suficientes para realizar esta acción",
        )
    return current_user


@router.get(
    "/resumen",
    response_model=schemas.DashboardResumenResponse,
    status_code=status.HTTP_200_OK,
    summary="Resumen ejecutivo de KPIs, proyección y desviación de cronograma",
)
def obtener_resumen_dashboard(
    db: Annotated[Session, Depends(database.get_db)],
    current_user: Annotated[models.Usuario, Depends(require_dashboard_access)],
    linea_id: Annotated[
        int | None,
        Query(
            description="ID de la línea de fondeo a consultar (si se omite, toma la primera activa)",
        ),
    ] = None,
):
    """
    Retorna el resumen de indicadores clave de desempeño (KPIs):
    - Metros totales, acumulados, restantes y porcentaje de avance.
    - Promedio de avance diario en los últimos 7 días con actividad y fecha estimada de término.
    - Detección algorítmica de desviación de cronograma respecto a la meta lineal esperada.
    - Serie temporal diaria para consumo directo en gráficos Recharts.
    """
    if current_user.rol not in ROLES_PERMITIDOS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permisos suficientes para realizar esta acción",
        )

    return dashboard_service.obtener_resumen(db=db, linea_id=linea_id)
