import os
import shutil
import uuid as uuid_lib
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app import auth, config, database, models, schemas

router = APIRouter(prefix="/registros", tags=["Archivos Adjuntos"])


@router.post(
    "/{uuid}/archivos",
    response_model=schemas.ArchivoResponse,
    status_code=status.HTTP_201_CREATED,
)
def subir_archivo_adjunto(
    uuid: str,
    file: UploadFile = File(
        ..., description="Archivo adjunto de evidencia en terreno"
    ),
    db: Session = Depends(database.get_db),
    current_user: models.Usuario = Depends(auth.get_current_user),
):
    """
    Recibe un archivo mediante multipart/form-data asociado a un registro de avance,
    lo almacena físicamente en UPLOAD_DIR (por defecto data/archivos/) y guarda sus
    metadatos en la tabla `archivos`.
    """
    registro = (
        db.query(models.RegistroAvance)
        .filter(models.RegistroAvance.id == uuid)
        .first()
    )
    if not registro:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"El registro de avance con UUID '{uuid}' no existe",
        )

    directorio_subidas = Path(config.UPLOAD_DIR)
    directorio_subidas.mkdir(parents=True, exist_ok=True)

    nombre_original = os.path.basename(file.filename or "adjunto.bin")
    prefijo_unico = uuid_lib.uuid4().hex[:8]
    nombre_archivo = f"{uuid}_{prefijo_unico}_{nombre_original}"
    ruta_destino = directorio_subidas / nombre_archivo

    try:
        with ruta_destino.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al guardar el archivo en disco: {exc}",
        ) from exc
    finally:
        file.file.close()

    tamano_bytes = ruta_destino.stat().st_size
    tipo_mime = file.content_type or "application/octet-stream"
    ruta_guardada = str(ruta_destino)

    nuevo_archivo = models.Archivo(
        registro_id=uuid,
        ruta=ruta_guardada,
        tipo=tipo_mime,
        tamano=tamano_bytes,
    )
    db.add(nuevo_archivo)
    db.flush()

    auditoria = models.Auditoria(
        entidad="archivos",
        entidad_id=str(nuevo_archivo.id),
        usuario_id=current_user.id,
        accion="CREATE",
        valores_antes=None,
        valores_despues={
            "id": nuevo_archivo.id,
            "registro_id": uuid,
            "ruta": ruta_guardada,
            "tipo": tipo_mime,
            "tamano": tamano_bytes,
        },
        fecha=models.utc_now(),
    )
    db.add(auditoria)
    db.commit()
    db.refresh(nuevo_archivo)
    return nuevo_archivo


@router.get(
    "/archivos/{archivo_id}",
    response_class=FileResponse,
    dependencies=[Depends(auth.get_current_user)],
)
def descargar_archivo_adjunto(
    archivo_id: int,
    db: Session = Depends(database.get_db),
):
    """Sirve un archivo adjunto almacenado en disco utilizando FileResponse."""
    archivo = db.query(models.Archivo).filter(models.Archivo.id == archivo_id).first()
    if not archivo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Archivo con ID {archivo_id} no encontrado",
        )

    if not os.path.isfile(archivo.ruta):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="El archivo físico no se encuentra en el almacenamiento del servidor",
        )

    nombre_descarga = os.path.basename(archivo.ruta)
    return FileResponse(
        path=archivo.ruta,
        media_type=archivo.tipo or "application/octet-stream",
        filename=nombre_descarga,
    )