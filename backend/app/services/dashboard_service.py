import math
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app import models, schemas


def _normalizar_datetime(dt: datetime | None) -> datetime | None:
    """Normaliza un datetime asegurando que sea consciente de zona horaria (UTC)."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


class DashboardService:
    """
    Servicio de inteligencia de negocio y analítica para monitoreo gerencial
    de líneas de fondeo marítimo.
    """

    def __init__(self, db: Session | None = None):
        self.db = db

    @staticmethod
    def seleccionar_linea(
        db: Session, linea_id: int | None = None
    ) -> models.LineaFondeo:
        """
        Obtiene la línea solicitada o, si no se especifica, la primera activa disponible.
        """
        if linea_id is not None:
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
            return linea

        # Selección automática para fase piloto: primera línea activa o primera existente
        linea = (
            db.query(models.LineaFondeo)
            .filter(models.LineaFondeo.estado == "activa")
            .first()
        )
        if not linea:
            linea = db.query(models.LineaFondeo).first()

        if not linea:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No se encontraron líneas de fondeo registradas",
            )
        return linea

    @staticmethod
    def calcular_metricas_base(
        linea: models.LineaFondeo,
        registros: list[models.RegistroAvance],
    ) -> dict[str, float]:
        """Calcula los metros totales, acumulados, restantes y porcentaje de avance."""
        metros_totales = float(linea.metros_totales)
        metros_acumulados = round(sum(float(r.metros_avanzados) for r in registros), 2)
        metros_restantes = round(max(0.0, metros_totales - metros_acumulados), 2)
        porcentaje_avance = (
            round((metros_acumulados / metros_totales) * 100, 2)
            if metros_totales > 0
            else 0.0
        )

        return {
            "metros_totales": metros_totales,
            "metros_acumulados": metros_acumulados,
            "metros_restantes": metros_restantes,
            "porcentaje_avance": porcentaje_avance,
        }

    @staticmethod
    def calcular_proyeccion_7d(
        registros: list[models.RegistroAvance],
        metros_restantes: float,
    ) -> tuple[float, int | None, datetime | None]:
        """
        Calcula la velocidad operativa de los últimos 7 días con actividad
        y proyecta los días y la fecha estimada de término.
        """
        ahora_utc = datetime.now(timezone.utc)

        # Identificar las fechas únicas con actividad ordenadas cronológicamente
        fechas_con_actividad = sorted({r.fecha.date() for r in registros if r.fecha})
        ultimos_7_dias = (
            set(fechas_con_actividad[-7:]) if fechas_con_actividad else set()
        )

        registros_7d = [
            r for r in registros if r.fecha and r.fecha.date() in ultimos_7_dias
        ]
        metros_7d = sum(float(r.metros_avanzados) for r in registros_7d)
        dias_con_maniobra = len(ultimos_7_dias)

        promedio_diario_7d = (
            round(metros_7d / dias_con_maniobra, 2) if dias_con_maniobra > 0 else 0.0
        )

        if metros_restantes <= 0:
            dias_estimados = 0
            fecha_estimada = ahora_utc
        elif promedio_diario_7d > 0:
            dias_estimados = math.ceil(metros_restantes / promedio_diario_7d)
            fecha_estimada = ahora_utc + timedelta(days=dias_estimados)
        else:
            dias_estimados = None
            fecha_estimada = None

        return promedio_diario_7d, dias_estimados, fecha_estimada

    @staticmethod
    def calcular_desviacion_cronograma(
        linea: models.LineaFondeo,
        metros_acumulados: float,
        metros_restantes: float,
    ) -> tuple[bool, str | None, float | None, float | None, str | None]:
        """
        Detección algorítmica de desviación de cronograma comparando el avance real
        con la meta lineal teórica esperada a la fecha actual.
        """
        if not linea.fecha_inicio or not linea.fecha_meta:
            return (
                False,
                None,
                None,
                None,
                "La línea no cuenta con fecha meta definida para estimar desviación de cronograma.",
            )

        inicio_dt = _normalizar_datetime(linea.fecha_inicio)
        meta_dt = _normalizar_datetime(linea.fecha_meta)
        ahora_utc = datetime.now(timezone.utc)

        dias_totales_planificados = max(1, (meta_dt.date() - inicio_dt.date()).days)
        dias_transcurridos = (ahora_utc.date() - inicio_dt.date()).days

        if dias_transcurridos <= 0:
            return (
                False,
                None,
                0.0,
                0.0,
                "La fecha actual no ha superado la fecha de inicio planificada.",
            )

        if metros_restantes <= 0:
            return (
                False,
                None,
                float(linea.metros_totales),
                0.0,
                "Línea completada satisfactoriamente.",
            )

        # Fracción temporal transcurrida (máximo 1.0 si ya venció el plazo)
        fraccion_tiempo = min(1.0, dias_transcurridos / dias_totales_planificados)
        meta_lineal_esperada = round(fraccion_tiempo * float(linea.metros_totales), 2)

        umbral_tolerancia = 0.80 * meta_lineal_esperada

        if meta_lineal_esperada > 0 and metros_acumulados < umbral_tolerancia:
            desfase_porcentual = round(
                ((meta_lineal_esperada - metros_acumulados) / meta_lineal_esperada)
                * 100,
                2,
            )

            # Severidad: ALTA si el atraso es >= 50% o si la fecha actual ya superó la fecha meta
            if desfase_porcentual >= 50.0 or ahora_utc.date() > meta_dt.date():
                severidad = "ALTA"
            else:
                severidad = "MEDIA"

            mensaje = (
                f"Desviación detectada: avance real ({metros_acumulados:.1f} m) con desfase "
                f"del {desfase_porcentual:.1f}% respecto a la meta esperada ({meta_lineal_esperada:.1f} m)"
            )
            return True, severidad, meta_lineal_esperada, desfase_porcentual, mensaje

        return (
            False,
            None,
            meta_lineal_esperada,
            0.0,
            "El avance se encuentra dentro del margen de tolerancia planificado.",
        )

    @staticmethod
    def generar_serie_temporal(
        registros: list[models.RegistroAvance],
    ) -> list[schemas.SerieTemporalPunto]:
        """
        Genera una serie cronológica diaria agregando metros diarios y acumulados
        en formato listo para componentes de gráficos (Recharts).
        """
        metros_por_dia = defaultdict(float)
        for r in registros:
            if r.fecha:
                dia_str = r.fecha.strftime("%Y-%m-%d")
                metros_por_dia[dia_str] += float(r.metros_avanzados)

        serie_temporal = []
        acumulado_dia = 0.0
        for dia in sorted(metros_por_dia.keys()):
            m_dia = round(metros_por_dia[dia], 2)
            acumulado_dia = round(acumulado_dia + m_dia, 2)
            serie_temporal.append(
                schemas.SerieTemporalPunto(
                    fecha=dia,
                    metros_dia=m_dia,
                    metros_acumulados=acumulado_dia,
                )
            )

        return serie_temporal

    @classmethod
    def obtener_resumen(
        cls,
        db: Session,
        linea_id: int | None = None,
    ) -> schemas.DashboardResumenResponse:
        """
        Procesa y consolida todas las métricas, proyecciones y alertas del dashboard
        para la línea especificada o la primera línea activa disponible.
        """
        linea = cls.seleccionar_linea(db=db, linea_id=linea_id)

        registros = (
            db.query(models.RegistroAvance)
            .filter(models.RegistroAvance.linea_id == linea.id)
            .order_by(models.RegistroAvance.fecha.asc())
            .all()
        )

        metricas = cls.calcular_metricas_base(linea=linea, registros=registros)
        promedio_7d, dias_estimados, fecha_estimada = cls.calcular_proyeccion_7d(
            registros=registros,
            metros_restantes=metricas["metros_restantes"],
        )

        alerta, severidad, meta_lineal, desfase, mensaje = (
            cls.calcular_desviacion_cronograma(
                linea=linea,
                metros_acumulados=metricas["metros_acumulados"],
                metros_restantes=metricas["metros_restantes"],
            )
        )

        serie_temporal = cls.generar_serie_temporal(registros=registros)

        return schemas.DashboardResumenResponse(
            linea_id=linea.id,
            nombre_linea=linea.nombre,
            estado_linea=linea.estado,
            metros_totales=metricas["metros_totales"],
            metros_acumulados=metricas["metros_acumulados"],
            metros_restantes=metricas["metros_restantes"],
            porcentaje_avance=metricas["porcentaje_avance"],
            promedio_diario_7d=promedio_7d,
            dias_estimados_termino=dias_estimados,
            fecha_estimada_termino=fecha_estimada,
            alerta_desviacion=alerta,
            severidad_desviacion=severidad,
            meta_lineal_esperada=meta_lineal,
            desfase_porcentual=desfase,
            mensaje_desviacion=mensaje,
            serie_temporal=serie_temporal,
        )

    def resumen(self, linea_id: int | None = None) -> schemas.DashboardResumenResponse:
        """Método de instancia que reutiliza la sesión configurada."""
        if self.db is None:
            raise ValueError(
                "No se ha configurado una sesión de base de datos en DashboardService"
            )
        return self.obtener_resumen(db=self.db, linea_id=linea_id)


# Exportación funcional a nivel de módulo
obtener_resumen = DashboardService.obtener_resumen
