from datetime import datetime, timezone

from app import models, schemas


def test_lineas_endpoints_crud_y_geolocalizacion(client, auth_headers, db_session):
    """Verifica que /lineas/ soporte creación, consulta y actualización con los nuevos campos de geolocalización."""
    # 1. Crear línea con coordenadas completas
    payload_creacion = {
        "nombre": "Línea Test Corral",
        "metros_totales": 800.0,
        "descripcion": "Línea de prueba en Bahía de Corral",
        "lat_inicio": -39.8828,
        "lon_inicio": -73.4265,
        "lat_muerto": -39.8895,
        "lon_muerto": -73.4330,
        "radio_tolerancia_m": 45.0,
        "zona_designada": [
            [-39.8800, -73.4200],
            [-39.8800, -73.4400],
            [-39.8950, -73.4400],
            [-39.8950, -73.4200],
        ],
    }

    res_post = client.post(
        "/lineas/",
        json=payload_creacion,
        headers=auth_headers["admin"],
    )
    assert res_post.status_code == 201
    linea_creada = res_post.json()
    assert linea_creada["nombre"] == "Línea Test Corral"
    assert linea_creada["lat_inicio"] == -39.8828
    assert linea_creada["lon_inicio"] == -73.4265
    assert linea_creada["lat_muerto"] == -39.8895
    assert linea_creada["lon_muerto"] == -73.4330
    assert linea_creada["radio_tolerancia_m"] == 45.0
    assert len(linea_creada["zona_designada"]) == 4

    linea_id = linea_creada["id"]

    # 2. Listar líneas
    res_list = client.get("/lineas/", headers=auth_headers["supervisor"])
    assert res_list.status_code == 200
    lineas = res_list.json()
    assert any(l["id"] == linea_id for l in lineas)

    # 3. Obtener línea por ID
    res_get = client.get(f"/lineas/{linea_id}", headers=auth_headers["gerente"])
    assert res_get.status_code == 200
    assert res_get.json()["id"] == linea_id

    # 4. Actualizar parcialmente con LineaFondeoUpdate
    payload_patch = {
        "radio_tolerancia_m": 60.0,
        "descripcion": "Descripción actualizada",
    }
    res_patch = client.patch(
        f"/lineas/{linea_id}",
        json=payload_patch,
        headers=auth_headers["admin"],
    )
    assert res_patch.status_code == 200
    linea_actualizada = res_patch.json()
    assert linea_actualizada["radio_tolerancia_m"] == 60.0
    assert linea_actualizada["descripcion"] == "Descripción actualizada"
    assert linea_actualizada["lat_muerto"] == -39.8895


def test_registro_avance_campos_geolocalizacion_y_soft_delete(
    client, auth_headers, linea_piloto, db_session
):
    """Verifica que dentro_zona y eliminado_en estén expuestos en RegistroAvanceResponse."""
    reg_id = "11111111-2222-3333-4444-555555555555"
    payload = {
        "id": reg_id,
        "linea_id": linea_piloto.id,
        "metros_avanzados": 50.0,
        "fecha": datetime.now(timezone.utc).isoformat(),
        "latitud": -39.8890,
        "longitud": -73.4325,
        "observacion": "Test dentro de zona",
    }

    res = client.put(
        f"/registros/{reg_id}",
        json=payload,
        headers=auth_headers["supervisor"],
    )
    assert res.status_code == 200
    data = res.json()
    assert "dentro_zona" in data
    assert data["dentro_zona"] is True
    assert "eliminado_en" in data
    assert data["eliminado_en"] is None
