import uuid
from datetime import datetime, timedelta, timezone

from app import models


def test_metros_avanzados_deben_ser_positivos(client, auth_headers, linea_piloto):
    """Test 1: Metros positivos (metros_avanzados <= 0 debe retornar 400)."""
    reg_id = str(uuid.uuid4())
    payload = {
        "id": reg_id,
        "linea_id": linea_piloto.id,
        "metros_avanzados": 0.0,
        "fecha": datetime.now(timezone.utc).isoformat(),
        "observacion": "Prueba metros cero",
    }
    response = client.put(
        f"/registros/{reg_id}",
        json=payload,
        headers=auth_headers["supervisor"],
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Los metros avanzados deben ser mayores a cero"


def test_fecha_registro_no_puede_ser_futura(client, auth_headers, linea_piloto):
    """Test 2: Fechas futuras (fecha futura debe retornar 400)."""
    reg_id = str(uuid.uuid4())
    fecha_futura = datetime.now(timezone.utc) + timedelta(days=2)
    payload = {
        "id": reg_id,
        "linea_id": linea_piloto.id,
        "metros_avanzados": 50.0,
        "fecha": fecha_futura.isoformat(),
        "observacion": "Prueba fecha futura",
    }
    response = client.put(
        f"/registros/{reg_id}",
        json=payload,
        headers=auth_headers["supervisor"],
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "La fecha del registro no puede ser futura"


def test_avance_acumulado_no_puede_superar_metros_totales(
    client, auth_headers, linea_piloto
):
    """Test 3: Límite acumulado (acumulado > metros_totales de la línea bloquea con 400)."""
    # linea_piloto tiene 1000.0 metros totales
    reg1_id = str(uuid.uuid4())
    payload_valido = {
        "id": reg1_id,
        "linea_id": linea_piloto.id,
        "metros_avanzados": 900.0,
        "fecha": datetime.now(timezone.utc).isoformat(),
        "observacion": "Primer tramo grande",
    }
    res1 = client.put(
        f"/registros/{reg1_id}",
        json=payload_valido,
        headers=auth_headers["supervisor"],
    )
    assert res1.status_code == 200

    # Segundo registro que excede el total (900 + 150 = 1050 > 1000)
    reg2_id = str(uuid.uuid4())
    payload_exceso = {
        "id": reg2_id,
        "linea_id": linea_piloto.id,
        "metros_avanzados": 150.0,
        "fecha": datetime.now(timezone.utc).isoformat(),
        "observacion": "Tramo excedente",
    }
    res2 = client.put(
        f"/registros/{reg2_id}",
        json=payload_exceso,
        headers=auth_headers["supervisor"],
    )
    assert res2.status_code == 400
    assert (
        res2.json()["detail"]
        == "El avance acumulado supera los metros totales programados para la línea"
    )


def test_idempotencia_sincronizacion_registro(
    client, auth_headers, linea_piloto, db_session
):
    """Test 4: Idempotencia (PUT idéntico repetido retorna 200 sin duplicar registros)."""
    reg_id = str(uuid.uuid4())
    fecha_fija = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    payload = {
        "id": reg_id,
        "linea_id": linea_piloto.id,
        "metros_avanzados": 75.0,
        "fecha": fecha_fija,
        "latitud": -41.47,
        "longitud": -72.94,
        "observacion": "Maniobra inicial",
    }

    # Primera sincronización
    res1 = client.put(
        f"/registros/{reg_id}",
        json=payload,
        headers=auth_headers["supervisor"],
    )
    assert res1.status_code == 200

    count_registros_1 = (
        db_session.query(models.RegistroAvance)
        .filter(models.RegistroAvance.id == reg_id)
        .count()
    )
    assert count_registros_1 == 1

    count_auditoria_1 = (
        db_session.query(models.Auditoria)
        .filter(models.Auditoria.entidad_id == reg_id)
        .count()
    )
    assert count_auditoria_1 == 1

    # Segunda sincronización idéntica (reintento offline)
    res2 = client.put(
        f"/registros/{reg_id}",
        json=payload,
        headers=auth_headers["supervisor"],
    )
    assert res2.status_code == 200

    count_registros_2 = (
        db_session.query(models.RegistroAvance)
        .filter(models.RegistroAvance.id == reg_id)
        .count()
    )
    count_auditoria_2 = (
        db_session.query(models.Auditoria)
        .filter(models.Auditoria.entidad_id == reg_id)
        .count()
    )

    # Verificar que NO se crearon filas duplicadas
    assert count_registros_2 == 1
    assert count_auditoria_2 == 1


def test_trazabilidad_inmutable_auditoria(
    client, auth_headers, linea_piloto, usuarios, db_session
):
    """Test 5: Auditoría inmutable (cada inserción crea registro en auditoria con accion='INSERT')."""
    reg_id = str(uuid.uuid4())
    payload = {
        "id": reg_id,
        "linea_id": linea_piloto.id,
        "metros_avanzados": 120.0,
        "fecha": datetime.now(timezone.utc).isoformat(),
        "latitud": -41.472,
        "longitud": -72.943,
        "observacion": "Verificación auditoría",
    }

    res = client.put(
        f"/registros/{reg_id}",
        json=payload,
        headers=auth_headers["supervisor"],
    )
    assert res.status_code == 200

    # Consultar la fila en la tabla Auditoria
    auditoria_row = (
        db_session.query(models.Auditoria)
        .filter(models.Auditoria.entidad_id == reg_id)
        .first()
    )
    assert auditoria_row is not None
    assert auditoria_row.entidad == "RegistroAvance"
    assert auditoria_row.accion == "INSERT"
    assert auditoria_row.usuario_id == usuarios["supervisor"].id
    assert auditoria_row.valores_antes is None
    assert auditoria_row.valores_despues is not None
    assert auditoria_row.valores_despues["metros_avanzados"] == 120.0
    assert auditoria_row.valores_despues["linea_id"] == linea_piloto.id


def test_control_acceso_rbac_gerente_solo_lectura(client, auth_headers, linea_piloto):
    """Test 6: Control de acceso RBAC (gerente recibe 403 Forbidden al intentar registrar avances)."""
    reg_id = str(uuid.uuid4())
    payload = {
        "id": reg_id,
        "linea_id": linea_piloto.id,
        "metros_avanzados": 80.0,
        "fecha": datetime.now(timezone.utc).isoformat(),
        "observacion": "Intento de registro por gerente",
    }

    response = client.put(
        f"/registros/{reg_id}",
        json=payload,
        headers=auth_headers["gerente"],
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "No tiene permisos para registrar avances"
