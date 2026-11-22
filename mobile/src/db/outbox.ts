import {
  getDB,
  obtenerLineaCachePorId,
  type OutboxItem,
  type RegistroLocal,
} from './database';
import { evaluarDentroZona } from '../utils/geoValidacion';

/**
 * Persiste de forma atómica un registro de avance local y encola su evento correspondiente
 * en la cola Transactional Outbox.
 *
 * Si la inserción en cualquiera de las tablas falla, la transacción revierte todos los cambios.
 *
 * @param registro Datos del registro de avance capturados en terreno.
 */
export const guardarRegistroYEncolar = async (
  registro: Omit<RegistroLocal, 'estado_sync' | 'creado_en' | 'version_esquema'> & {
    dentro_zona?: number | boolean | null;
  }
): Promise<void> => {
  const db = getDB();
  const creadoEn = new Date().toISOString();

  // Resolución de dentro_zona (1 o 0, por defecto 1 si no se provee ni se encuentra geometría)
  let dentroZonaInt: number;
  if (registro.dentro_zona !== undefined && registro.dentro_zona !== null) {
    dentroZonaInt =
      registro.dentro_zona === true || registro.dentro_zona === 1 ? 1 : 0;
  } else {
    try {
      const linea = await obtenerLineaCachePorId(registro.linea_id);
      dentroZonaInt = evaluarDentroZona(linea, registro.latitud, registro.longitud) ? 1 : 0;
    } catch {
      dentroZonaInt = 1;
    }
  }

  // Payload que espera la API del backend en el endpoint PUT /registros/{uuid}
  const payload = JSON.stringify({
    id: registro.id,
    linea_id: registro.linea_id,
    usuario_id: registro.usuario_id,
    metros_avanzados: registro.metros_avanzados,
    fecha: registro.fecha,
    latitud: registro.latitud,
    longitud: registro.longitud,
    estado: registro.estado || 'activa',
    observacion: registro.observacion ?? null,
    dentro_zona: dentroZonaInt === 1,
    version_esquema: 1,
  });

  await db.withTransactionAsync(async () => {
    // 1. Inserción atómica en la tabla local registros_locales
    await db.runAsync(
      `INSERT INTO registros_locales (
        id,
        linea_id,
        usuario_id,
        metros_avanzados,
        fecha,
        latitud,
        longitud,
        estado,
        observacion,
        estado_sync,
        creado_en,
        sincronizado_en,
        version_esquema,
        dentro_zona
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        registro.id,
        registro.linea_id,
        registro.usuario_id,
        registro.metros_avanzados,
        registro.fecha,
        registro.latitud,
        registro.longitud,
        registro.estado || 'activa',
        registro.observacion ?? null,
        'pendiente',
        creadoEn,
        registro.sincronizado_en ?? null,
        1,
        dentroZonaInt,
      ]
    );

    // 2. Inserción atómica en la cola Transactional Outbox
    await db.runAsync(
      `INSERT INTO outbox (
        uuid,
        metodo,
        endpoint,
        payload,
        estado,
        reintentos,
        creado_en,
        ultimo_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        registro.id,
        'PUT',
        `/registros/${registro.id}`,
        payload,
        'pendiente',
        0,
        creadoEn,
        null,
      ]
    );
  });
};

/**
 * Obtiene los elementos pendientes o fallidos con menos de 5 reintentos en la cola Outbox,
 * ordenados cronológicamente ascendente (FIFO).
 *
 * @param limite Cantidad máxima de ítems a recuperar (por defecto 10).
 * @returns Lista de ítems en la cola Outbox listos para procesar.
 */
export const obtenerOutboxPendientes = async (limite = 10): Promise<OutboxItem[]> => {
  const db = getDB();
  return await db.getAllAsync<OutboxItem>(
    `SELECT id, uuid, metodo, endpoint, payload, estado, reintentos, creado_en, ultimo_error
     FROM outbox
     WHERE estado = 'pendiente' OR (estado = 'fallido' AND reintentos < 5)
     ORDER BY creado_en ASC
     LIMIT ?`,
    [limite]
  );
};

/**
 * Marca un evento outbox como completado con éxito:
 * - Elimina el elemento procesado de la tabla `outbox` para mantenerla compacta.
 * - Actualiza `registros_locales` a `estado_sync = 'sincronizado'` y registra `sincronizado_en`.
 *
 * Ambas acciones se ejecutan dentro de una transacción atómica.
 *
 * @param uuid Identificador único (UUID) del registro sincronizado.
 */
export const marcarOutboxCompletado = async (uuid: string): Promise<void> => {
  const db = getDB();
  const sincronizadoEn = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    // 1. Elimina de la cola outbox
    await db.runAsync('DELETE FROM outbox WHERE uuid = ?', [uuid]);

    // 2. Actualiza el registro local como sincronizado
    await db.runAsync(
      `UPDATE registros_locales
       SET estado_sync = 'sincronizado',
           sincronizado_en = ?
       WHERE id = ?`,
      [sincronizadoEn, uuid]
    );
  });
};

/**
 * Registra un fallo durante la sincronización de un evento outbox:
 * - Si es conflicto o error de regla de negocio (400, 409, 422): marca `estado_sync = 'conflicto'`
 *   en `registros_locales` y `estado = 'conflicto'` en `outbox` con el detalle del error.
 * - Si es un error transitorio de red o 500: incrementa el contador `reintentos`, actualiza
 *   `ultimo_error` y establece `estado = 'fallido'` para reintento posterior.
 *
 * @param uuid Identificador único (UUID) del registro con error.
 * @param errorMsg Mensaje o detalle del error ocurrido.
 * @param esConflicto Indica si el backend rechazó la operación por conflicto o validación de negocio definitiva.
 */
export const marcarOutboxError = async (
  uuid: string,
  errorMsg: string,
  esConflicto = false
): Promise<void> => {
  const db = getDB();

  if (esConflicto) {
    await db.withTransactionAsync(async () => {
      await db.runAsync(
        `UPDATE registros_locales
         SET estado_sync = 'conflicto'
         WHERE id = ?`,
        [uuid]
      );

      await db.runAsync(
        `UPDATE outbox
         SET estado = 'conflicto',
             ultimo_error = ?
         WHERE uuid = ?`,
        [errorMsg, uuid]
      );
    });
  } else {
    await db.runAsync(
      `UPDATE outbox
       SET reintentos = reintentos + 1,
           ultimo_error = ?,
           estado = 'fallido'
       WHERE uuid = ?`,
      [errorMsg, uuid]
    );
  }
};

/**
 * Cuenta la cantidad total de registros locales con sincronización pendiente.
 * Utilizado para alimentar badges e indicadores visuales de conectividad y sincronización.
 *
 * @returns Número total de registros locales pendientes de sincronizar.
 */
export const contarRegistrosPendientes = async (): Promise<number> => {
  const db = getDB();
  const row = await db.getFirstAsync<{ total: number }>(
    `SELECT COUNT(*) as total FROM registros_locales WHERE estado_sync = 'pendiente'`
  );
  return row?.total ?? 0;
};

/**
 * Obtiene los registros de avance locales más recientes ordenados descendente por fecha de creación.
 *
 * @param limite Cantidad máxima de registros a recuperar (por defecto 10).
 * @returns Lista de registros locales ordenados cronológicamente desde el más nuevo.
 */
export const obtenerRegistrosRecientes = async (limite = 10): Promise<RegistroLocal[]> => {
  const db = getDB();
  return await db.getAllAsync<RegistroLocal>(
    `SELECT id, linea_id, usuario_id, metros_avanzados, fecha, latitud, longitud,
            estado, observacion, estado_sync, creado_en, sincronizado_en, version_esquema, dentro_zona
     FROM registros_locales
     ORDER BY creado_en DESC
     LIMIT ?`,
    [limite]
  );
};
