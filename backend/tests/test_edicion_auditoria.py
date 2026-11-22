import io
import uuid
from datetime import datetime, timedelta, timezone

from app import models


def test_geovalidacion_dentro_vs_fuera_zona(client, auth_headers, db_session):
    """
    Test 1: Verifica que un registro con coordenadas dentro de la zona designada guarde dentro_zona=True,
    y que fuera de ella guarde dentro_zona=False sin arrojar excepción HTTP 400.
    """
    # Crear línea con zona delimitada en Bahía de Corral
    linea = models.LineaFondeo(
        nombre="Línea Geometría Test",
        metros_totales=2000.0,
        estado="activa",
        zona_designada=[
            [-39.8800, -73.4200],
            [-39.8800, -73.4400],
            [-39.9000, -73.4400],
            [-39.9000, -73.4200],
        ],
    )
    db_session.add(linea)
    db_session.commit()
    db_session.refresh(linea)

    # 1. Punto DENTRO del polígono (-39.8900, -73.4300)
    reg1_id = str(uuid.uuid4())
    payload_dentro = {
        "id": reg1_id,
        "linea_id": linea.id,
        "metros_avanzados": 100.0,
        "fecha": datetime.now(timezone.utc).isoformat(),
        "latitud": -39.8900,
        "longitud": -73.4300,
        "observacion": "Punto dentro del polígono",
    }
    res_dentro = client.put(
        f"/registros/{reg1_id}",
        json=payload_dentro,
        headers=auth_headers["supervisor"],
    )
    assert res_dentro.status_code == 200
    assert res_dentro.json()["dentro_zona"] is True

    # 2. Punto FUERA del polígono (-39.8500, -73.4300)
    reg2_id = str(uuid.uuid4())
    payload_fuera = {
        "id": reg2_id,
        "linea_id": linea.id,
        "metros_avanzados": 150.0,
        "fecha": datetime.now(timezone.utc).isoformat(),
        "latitud": -39.8500,
        "longitud": -73.4300,
        "observacion": "Punto fuera del polígono (alerta)",
    }
    res_fuera = client.put(
        f"/registros/{reg2_id}",
        json=payload_fuera,
        headers=auth_headers["supervisor"],
    )
    # No debe arrojar error HTTP, sino guardarse con dentro_zona=False
    assert res_fuera.status_code == 200
    assert res_fuera.json()["dentro_zona"] is False

    # Verificar que el dashboard refleje 1 registro fuera de zona
    res_dash = client.get(
        f"/dashboard/resumen?linea_id={linea.id}",
        headers=auth_headers["gerente"],
    )
    assert res_dash.status_code == 200
    assert res_dash.json()["registros_fuera_zona"] == 1


def test_geovalidacion_haversine_radio_tolerancia(client, auth_headers, db_session):
    """
    Test 1b: Verifica geo-validación por distancia Haversine cuando no hay polígono
    pero existen lat_muerto y lon_muerto con radio de tolerancia.
    """
    linea = models.LineaFondeo(
        nombre="Línea Punto Muerto Test",
        metros_totales=1000.0,
        estado="activa",
        lat_muerto=-39.8895,
        lon_muerto=-73.4330,
        radio_tolerancia_m=50.0,
    )
    db_session.add(linea)
    db_session.commit()
    db_session.refresh(linea)

    # 1. Coordenadas a ~10 metros (dentro de tolerancia de 50m)
    reg1_id = str(uuid.uuid4())
    res1 = client.put(
        f"/registros/{reg1_id}",
        json={
            "id": reg1_id,
            "linea_id": linea.id,
            "metros_avanzados": 50.0,
            "fecha": datetime.now(timezone.utc).isoformat(),
            "latitud": -39.88955,
            "longitud": -73.43305,
        },
        headers=auth_headers["supervisor"],
    )
    assert res1.status_code == 200
    assert res1.json()["dentro_zona"] is True

    # 2. Coordenadas a ~500 metros (muy lejos de la tolerancia)
    reg2_id = str(uuid.uuid4())
    res2 = client.put(
        f"/registros/{reg2_id}",
        json={
            "id": reg2_id,
            "linea_id": linea.id,
            "metros_avanzados": 50.0,
            "fecha": datetime.now(timezone.utc).isoformat(),
            "latitud": -39.8950,
            "longitud": -73.4330,
        },
        headers=auth_headers["supervisor"],
    )
    assert res2.status_code == 200
    assert res2.json()["dentro_zona"] is False


def test_patch_lineas_estados_y_auditoria_con_usuario_nombre(
    client, auth_headers, linea_piloto, usuarios
):
    """
    Test 2: PATCH /lineas/{id} cambiando estado y descripción opcional
    + lectura en GET /lineas/{id}/auditoria verificando usuario_nombre.
    """
    # Supervisor ahora tiene acceso para cambiar estado
    res_patch = client.patch(
        f"/lineas/{linea_piloto.id}",
        json={
            "estado": "mantencion",
            "descripcion": "Línea temporalmente en mantenimiento por maniobras",
        },
        headers=auth_headers["supervisor"],
    )
    assert res_patch.status_code == 200
    data_patch = res_patch.json()
    assert data_patch["estado"] == "mantencion"
    assert data_patch["descripcion"] == "Línea temporalmente en mantenimiento por maniobras"

    # Verificar rechazo de estado inválido
    res_invalido = client.patch(
        f"/lineas/{linea_piloto.id}",
        json={"estado": "estado_inexistente"},
        headers=auth_headers["supervisor"],
    )
    assert res_invalido.status_code == 400

    # Consultar auditoría de la línea
    res_audit = client.get(
        f"/lineas/{linea_piloto.id}/auditoria",
        headers=auth_headers["gerente"],
    )
    assert res_audit.status_code == 200
    auditorias = res_audit.json()
    assert len(auditorias) >= 1
    ultima_auditoria = auditorias[0]
    assert ultima_auditoria["entidad"] == "lineas_fondeo"
    assert ultima_auditoria["accion"] == "UPDATE"
    assert ultima_auditoria["usuario_id"] == usuarios["supervisor"].id
    assert ultima_auditoria["usuario_nombre"] == usuarios["supervisor"].nombre
    assert ultima_auditoria["valores_despues"]["estado"] == "mantencion"


def test_edicion_eliminacion_reversion_estado_y_dashboard(
    client, auth_headers, db_session, usuarios
):
    """
    Test 3: PATCH /registros/{uuid} y DELETE /registros/{uuid}:
    - Verificación de auditoría con usuario_nombre.
    - Exclusión de registros eliminados en GET /dashboard/resumen.
    - Reversión automática de línea 'completada' -> 'activa' al reducir o eliminar avance.
    """
    # Crear línea con 200 metros
    linea = models.LineaFondeo(
        nombre="Línea Reversión Test",
        metros_totales=200.0,
        estado="activa",
    )
    db_session.add(linea)
    db_session.commit()
    db_session.refresh(linea)

    reg_id = str(uuid.uuid4())
    # 1. Registrar 200m -> la línea debe pasar automáticamente a 'completada'
    res_put = client.put(
        f"/registros/{reg_id}",
        json={
            "id": reg_id,
            "linea_id": linea.id,
            "metros_avanzados": 200.0,
            "fecha": datetime.now(timezone.utc).isoformat(),
            "observacion": "Avance completo",
        },
        headers=auth_headers["supervisor"],
    )
    assert res_put.status_code == 200

    db_session.refresh(linea)
    assert linea.estado == "completada"

    # 2. Modificar registro vía PATCH /registros/{uuid} reduciendo avance a 150m (en línea completada)
    res_patch = client.patch(
        f"/registros/{reg_id}",
        json={"metros_avanzados": 150.0, "observacion": "Corrección de metraje"},
        headers=auth_headers["gerente"],
    )
    assert res_patch.status_code == 200
    assert res_patch.json()["metros_avanzados"] == 150.0

    # La línea debe revertirse a 'activa' automáticamente al bajar de 200m
    db_session.refresh(linea)
    assert linea.estado == "activa"

    # Verificar auditoría del registro
    res_audit_reg = client.get(
        f"/registros/{reg_id}/auditoria",
        headers=auth_headers["admin"],
    )
    assert res_audit_reg.status_code == 200
    audits = res_audit_reg.json()
    assert len(audits) >= 2  # INSERT + UPDATE
    assert audits[0]["accion"] == "UPDATE"
    assert audits[0]["usuario_id"] == usuarios["gerente"].id
    assert audits[0]["usuario_nombre"] == usuarios["gerente"].nombre

    # 3. Soft-delete vía DELETE /registros/{uuid}
    res_del = client.delete(
        f"/registros/{reg_id}",
        headers=auth_headers["admin"],
    )
    assert res_del.status_code == 200
    assert res_del.json()["eliminado_en"] is not None

    # Verificar que GET /registros/{uuid} retorna 404
    res_get_del = client.get(
        f"/registros/{reg_id}",
        headers=auth_headers["supervisor"],
    )
    assert res_get_del.status_code == 404

    # Verificar que el dashboard excluye el registro eliminado (metros acumulados = 0)
    res_dash = client.get(
        f"/dashboard/resumen?linea_id={linea.id}",
        headers=auth_headers["gerente"],
    )
    assert res_dash.status_code == 200
    assert res_dash.json()["metros_acumulados"] == 0.0

    # 4. Sincronización diferencial: GET /registros?desde=... debe incluir el registro eliminado
    hace_un_minuto = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    res_sinc_dif = client.get(
        f"/registros?desde={hace_un_minuto}",
        headers=auth_headers["supervisor"],
    )
    assert res_sinc_dif.status_code == 200
    registros_sinc = res_sinc_dif.json()
    eliminados = [r for r in registros_sinc if r["id"] == reg_id]
    assert len(eliminados) == 1
    assert eliminados[0]["eliminado_en"] is not None


def test_validacion_archivos_tamano_y_extension(client, auth_headers, db_session):
    """
    Test 4: Validación en subida de archivos adjuntos (límite 10 MB y extensiones permitidas).
    """
    linea = models.LineaFondeo(
        nombre="Línea Archivos Test",
        metros_totales=500.0,
        estado="activa",
    )
    db_session.add(linea)
    db_session.commit()

    reg_id = str(uuid.uuid4())
    client.put(
        f"/registros/{reg_id}",
        json={
            "id": reg_id,
            "linea_id": linea.id,
            "metros_avanzados": 50.0,
            "fecha": datetime.now(timezone.utc).isoformat(),
        },
        headers=auth_headers["supervisor"],
    )

    # 1. Extensión no permitida (.exe) -> 400 Bad Request
    archivo_invalido = io.BytesIO(b"malware content")
    res_ext = client.post(
        f"/registros/{reg_id}/archivos",
        files={"file": ("virus.exe", archivo_invalido, "application/x-msdownload")},
        headers=auth_headers["supervisor"],
    )
    assert res_ext.status_code == 400
    assert "no permitida" in res_ext.json()["detail"]

    # 2. Archivo mayor a 10 MB -> 413 Request Entity Too Large
    contenido_pesado = io.BytesIO(b"0" * (10 * 1024 * 1024 + 1024))  # 10MB + 1KB
    res_tamano = client.post(
        f"/registros/{reg_id}/archivos",
        files={"file": ("foto_grande.jpg", contenido_pesado, "image/jpeg")},
        headers=auth_headers["supervisor"],
    )
    assert res_tamano.status_code == 413

    # 3. Archivo válido (.png) de 1 KB -> 201 Created
    contenido_valido = io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"0" * 1024)
    res_valido = client.post(
        f"/registros/{reg_id}/archivos",
        files={"file": ("evidencia.png", contenido_valido, "image/png")},
        headers=auth_headers["supervisor"],
    )
    assert res_valido.status_code == 201
    assert res_valido.json()["tipo"] == "image/png"
