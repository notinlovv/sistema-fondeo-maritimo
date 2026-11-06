from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import auth, dashboard, registros, reportes

app = FastAPI(
    title="API Sistema de Fondeo",
    description="Backend para el registro de líneas de fondeo en terreno",
    version="1.0.0",
)

# Configuración CORS para permitir peticiones del dashboard y la app móvil
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Ajustar en producción al dominio del dashboard
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Incluir los enrutadores
app.include_router(auth.router)
app.include_router(dashboard.router)
app.include_router(registros.router)
app.include_router(reportes.router)


@app.get("/")
def health_check():
    return {"estado": "API operativa", "fase": "piloto SQLite"}
