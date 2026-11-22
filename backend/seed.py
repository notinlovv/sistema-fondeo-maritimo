from app.auth import get_password_hash
from app.database import SessionLocal
from app.models import LineaFondeo, Usuario


def poblar_bd():
    db = SessionLocal()
    try:
        print("Revisando base de datos...")

        # Crear usuario de prueba si no existe
        usuario = (
            db.query(Usuario).filter(Usuario.email == "supervisor@fondeo.cl").first()
        )
        if not usuario:
            usuario = Usuario(
                nombre="Supervisor Piloto",
                email="supervisor@fondeo.cl",
                hash_password=get_password_hash("admin123"),
                rol="supervisor",
            )
            db.add(usuario)
            print("Usuario supervisor creado: supervisor@fondeo.cl / admin123")

        # Líneas de ejemplo con coordenadas reales en Bahía de Corral / Valdivia
        lineas_datos = [
            {
                "nombre": "Línea Piloto 1",
                "metros_totales": 1500.0,
                "descripcion": "Línea de fondeo principal Bahía de Corral, sector Puerto Corral",
                "lat_inicio": -39.8828,
                "lon_inicio": -73.4265,
                "lat_muerto": -39.8895,
                "lon_muerto": -73.4330,
                "radio_tolerancia_m": 50.0,
                "zona_designada": [
                    [-39.8800, -73.4200],
                    [-39.8800, -73.4400],
                    [-39.8950, -73.4400],
                    [-39.8950, -73.4200],
                ],
            },
            {
                "nombre": "Línea Piloto 2 - Niebla",
                "metros_totales": 1200.0,
                "descripcion": "Línea de fondeo secundaria sector Caleta Niebla, Bahía de Corral",
                "lat_inicio": -39.8680,
                "lon_inicio": -73.3980,
                "lat_muerto": -39.8745,
                "lon_muerto": -73.4050,
                "radio_tolerancia_m": 40.0,
                "zona_designada": [
                    [-39.8650, -73.3950],
                    [-39.8650, -73.4100],
                    [-39.8780, -73.4100],
                    [-39.8780, -73.3950],
                ],
            },
        ]

        for item in lineas_datos:
            linea = (
                db.query(LineaFondeo)
                .filter(LineaFondeo.nombre == item["nombre"])
                .first()
            )
            if not linea:
                linea = LineaFondeo(**item)
                db.add(linea)
                print(f"Línea de fondeo creada: {item['nombre']}")
            else:
                for k, v in item.items():
                    setattr(linea, k, v)
                print(f"Línea de fondeo actualizada con coordenadas: {item['nombre']}")

        db.commit()
        print("Proceso finalizado con éxito.")
    finally:
        db.close()


if __name__ == "__main__":
    poblar_bd()