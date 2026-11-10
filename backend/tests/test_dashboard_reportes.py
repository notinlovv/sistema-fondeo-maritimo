import uuid
from datetime import datetime, timedelta, timezone

from app import models


def test_dashboard_resumen_calcula_metricas_correctas(
    client, auth_headers, linea_piloto, db_session
):
    """Test 1: GET /dashboard/resumen calcula correctamente porcentaje de avance y metros restantes."""
    # linea_piloto tiene 1000.0 metros totales
    # Agregamos dos avances: 250m y 150m = 400m acumulados (40% de avance, 600m restantes)
    now_utc = datetime.now(timezone.utc)
    db_session.add_all(
        [
            models.RegistroAvance(
                id=str(uuid.uuid4()),
                linea_id=linea_piloto.id,
                usuario_id=1,
                metros_avanzados=250.0,
                fecha=now_utc - timedelta(days=2),
                estado="sincronizado",
            ),
            models.RegistroAvance(
                id=str(uuid.uuid4()),
                linea_id=linea_piloto.id,
                usuario_id=1,
                metros_avanzados=150.0,
                fecha=now_utc - timedelta(days=1),
                estado="sincronizado",
            ),
        ]
    )
    db_session.commit()

    # Consultar dashboard como gerente
    response = client.get(
        f"/dashboard/resumen?linea_id={linea_piloto.id}",
        headers=auth_headers["gerente"],
    )
    assert response.status_code == 200
    data = response.json()

    assert data["linea_id"] == linea_piloto.id
    assert data["metros_totales"] == 1000.0
    assert data["metros_acumulados"] == 400.0
    assert data["metros_restantes"] == 600.0
    assert data["porcentaje_avance"] == 40.0
    assert "serie_temporal" in data
    assert len(data["serie_temporal"]) == 2
    assert "promedio_diario_7d" in data


def test_descarga_reportes_excel_y_pdf(client, auth_headers, linea_piloto, db_session):
    """Test 2: GET /reportes/avance.xlsx y .pdf retornan 200 con Content-Type binario."""
    # Agregar un avance para tener datos en el reporte
    db_session.add(
        models.RegistroAvance(
            id=str(uuid.uuid4()),
            linea_id=linea_piloto.id,
            usuario_id=1,
            metros_avanzados=100.0,
            fecha=datetime.now(timezone.utc),
            estado="sincronizado",
        )
    )
    db_session.commit()

    # 1. Reporte Excel (.xlsx)
    resp_excel = client.get(
        f"/reportes/avance.xlsx?linea_id={linea_piloto.id}",
        headers=auth_headers["supervisor"],
    )
    assert resp_excel.status_code == 200
    assert (
        resp_excel.headers["Content-Type"]
        == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert f"reporte_avance_linea_{linea_piloto.id}.xlsx" in resp_excel.headers.get(
        "Content-Disposition", ""
    )
    assert len(resp_excel.content) > 1000

    # 2. Reporte PDF (.pdf)
    resp_pdf = client.get(
        f"/reportes/avance.pdf?linea_id={linea_piloto.id}",
        headers=auth_headers["admin"],
    )
    assert resp_pdf.status_code == 200
    assert resp_pdf.headers["Content-Type"] == "application/pdf"
    assert f"reporte_avance_linea_{linea_piloto.id}.pdf" in resp_pdf.headers.get(
        "Content-Disposition", ""
    )
    assert resp_pdf.content.startswith(b"%PDF-")
    assert len(resp_pdf.content) > 1000
