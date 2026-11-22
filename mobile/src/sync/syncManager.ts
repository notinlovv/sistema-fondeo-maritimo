import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import * as SecureStore from 'expo-secure-store';
import {
  getDB,
  guardarLineasCache,
  guardarMetaSync,
  obtenerMetaSync,
  type LineaCache,
} from '../db/database';
import {
  obtenerOutboxPendientes,
  marcarOutboxCompletado,
  marcarOutboxError,
} from '../db/outbox';

/**
 * URL base de la API REST del backend de fondeo.
 */
export const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000'
).replace(/\/+$/, '');

/**
 * Resultado del procesamiento de un lote de sincronización.
 */
export interface ResultadoSincronizacion {
  procesados: number;
  errores: number;
}

/**
 * Bandera de exclusión mutua (Mutex) para evitar sincronizaciones concurrentes.
 */
let isSyncing = false;

/**
 * Retorna true si actualmente hay un proceso de sincronización en curso.
 */
export const isSyncActive = (): boolean => isSyncing;

/**
 * Ejecuta el paso de sincronización bidireccional incremental desde el servidor (Pull):
 * 1. Consulta GET /lineas/ y refresca la caché local SQLite (lineas_cache).
 * 2. Consulta GET /registros (con filtro diferencial ?desde= si existe cursor).
 * 3. Procesa altas, modificaciones y bajas (soft-delete), preservando los registros locales
 *    con cambios pendientes de envío en el outbox.
 * 4. Actualiza el cursor de sincronización 'ultima_sincronizacion_pull' en sync_meta.
 *
 * @param token Token de autenticación JWT activo o null si no hay sesión.
 */
export const sincronizarCambiosDesdeServidor = async (
  token: string | null
): Promise<void> => {
  const db = getDB();
  const headersBase: Record<string, string> = {
    Accept: 'application/json',
  };

  if (token) {
    headersBase['Authorization'] = `Bearer ${token}`;
  }

  // 1. Descarga y actualización de líneas de fondeo en caché local
  try {
    const resLineas = await fetch(`${API_BASE_URL}/lineas/`, {
      method: 'GET',
      headers: headersBase,
    });

    if (resLineas.ok) {
      const lineas = (await resLineas.json()) as any[];
      if (Array.isArray(lineas)) {
        const ahora = new Date().toISOString();
        const lineasMapeadas: LineaCache[] = lineas.map((l) => ({
          id: l.id,
          nombre: l.nombre,
          estado: l.estado ?? 'activa',
          metros_totales: l.metros_totales,
          lat_inicio: l.lat_inicio ?? null,
          lon_inicio: l.lon_inicio ?? null,
          lat_muerto: l.lat_muerto ?? null,
          lon_muerto: l.lon_muerto ?? null,
          radio_tolerancia_m: l.radio_tolerancia_m ?? 50.0,
          zona_designada: l.zona_designada
            ? typeof l.zona_designada === 'string'
              ? l.zona_designada
              : JSON.stringify(l.zona_designada)
            : null,
          actualizado_en: ahora,
        }));
        await guardarLineasCache(lineasMapeadas);
      }
    } else {
      console.warn(`No se pudo actualizar lineas_cache: HTTP ${resLineas.status}`);
    }
  } catch (err) {
    console.warn('Error al obtener /lineas/ desde el servidor:', err);
  }

  // 2. Consulta incremental de registros (Pull)
  try {
    const ultimaSincronizacion = await obtenerMetaSync('ultima_sincronizacion_pull');
    const endpointRegistros = ultimaSincronizacion
      ? `${API_BASE_URL}/registros?desde=${encodeURIComponent(ultimaSincronizacion)}`
      : `${API_BASE_URL}/registros`;

    const resRegistros = await fetch(endpointRegistros, {
      method: 'GET',
      headers: headersBase,
    });

    if (resRegistros.ok) {
      const registros = (await resRegistros.json()) as any[];
      if (Array.isArray(registros)) {
        // Consultar identificadores únicos con operaciones pendientes en outbox
        const outboxPendientes = await db.getAllAsync<{ uuid: string }>(
          "SELECT uuid FROM outbox WHERE estado = 'pendiente'"
        );
        const uuidsPendientes = new Set(outboxPendientes.map((o) => o.uuid));

        await db.withTransactionAsync(async () => {
          for (const reg of registros) {
            // Regla: no sobreescribir si el dispositivo tiene una modificación local pendiente
            if (uuidsPendientes.has(reg.id)) {
              continue;
            }

            if (reg.eliminado_en !== null && reg.eliminado_en !== undefined) {
              // Registro eliminado en oficina (soft-delete): suprimir de la base local
              await db.runAsync('DELETE FROM registros_locales WHERE id = ?', [reg.id]);
            } else {
              // Registro activo/actualizado desde el servidor
              const dentroZona = reg.dentro_zona === false ? 0 : 1;
              const sincronizadoEn = reg.sincronizado_en || new Date().toISOString();

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
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  linea_id = excluded.linea_id,
                  usuario_id = excluded.usuario_id,
                  metros_avanzados = excluded.metros_avanzados,
                  fecha = excluded.fecha,
                  latitud = excluded.latitud,
                  longitud = excluded.longitud,
                  estado = excluded.estado,
                  observacion = excluded.observacion,
                  estado_sync = 'sincronizado',
                  sincronizado_en = excluded.sincronizado_en,
                  version_esquema = excluded.version_esquema,
                  dentro_zona = excluded.dentro_zona`,
                [
                  reg.id,
                  reg.linea_id,
                  reg.usuario_id ?? 1,
                  reg.metros_avanzados,
                  reg.fecha,
                  reg.latitud ?? 0.0,
                  reg.longitud ?? 0.0,
                  reg.estado ?? 'activa',
                  reg.observacion ?? null,
                  'sincronizado',
                  reg.creado_en || sincronizadoEn,
                  sincronizadoEn,
                  reg.version_esquema ?? 1,
                  dentroZona,
                ]
              );
            }
          }
        });

        // 3. Guardar el nuevo cursor de sincronización UTC
        const ahoraUtc = new Date().toISOString();
        await guardarMetaSync('ultima_sincronizacion_pull', ahoraUtc);
      }
    } else {
      console.warn(
        `No se pudo sincronizar registros desde el servidor: HTTP ${resRegistros.status}`
      );
    }
  } catch (err) {
    console.warn('Error durante el pull de registros desde el servidor:', err);
  }
};

/**
 * Procesa la cola Outbox en estricto orden cronológico FIFO enviando
 * las peticiones HTTP idempotentes (PUT /registros/{uuid}) hacia el backend (Push).
 * Luego de vaciar la cola o procesar el lote, ejecuta la sincronización incremental (Pull).
 *
 * @returns Resumen con la cantidad de registros procesados con éxito y con errores.
 */
export const sincronizarLote = async (): Promise<ResultadoSincronizacion> => {
  // 1. Control de concurrencia: abortar si ya hay un proceso en curso
  if (isSyncing) {
    return { procesados: 0, errores: 0 };
  }

  // 2. Verificación de conectividad activa a internet
  try {
    const netState: NetInfoState = await NetInfo.fetch();
    const hayConexion = Boolean(netState.isConnected && netState.isInternetReachable !== false);

    if (!hayConexion) {
      return { procesados: 0, errores: 0 };
    }
  } catch (netError) {
    console.warn('No se pudo verificar el estado de la red:', netError);
    return { procesados: 0, errores: 0 };
  }

  isSyncing = true;
  let procesados = 0;
  let errores = 0;
  let abortadoPorAuth = false;

  try {
    // 3. Obtener token de autenticación si existe sesión activa guardada
    let authToken: string | null = null;
    try {
      authToken = await SecureStore.getItemAsync('auth_token');
    } catch {
      // Si SecureStore no está disponible o no hay token, continúa sin Authorization
    }

    const headersBase: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    if (authToken) {
      headersBase['Authorization'] = `Bearer ${authToken}`;
    }

    // 4. Proceso de vaciado de Outbox (Push) en orden FIFO
    const procesadosEnEstaEjecucion = new Set<number>();

    while (true) {
      const lote = await obtenerOutboxPendientes(10);
      const pendientes = lote.filter((item) => !procesadosEnEstaEjecucion.has(item.id));

      if (pendientes.length === 0) {
        break;
      }

      for (const item of pendientes) {
        procesadosEnEstaEjecucion.add(item.id);
        const { uuid, metodo, endpoint, payload } = item;
        const urlCompleta = `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

        try {
          const response = await fetch(urlCompleta, {
            method: metodo || 'PUT',
            headers: headersBase,
            body: payload,
          });

          if (response.ok) {
            // 200 OK / 201 Created: Transacción exitosa
            await marcarOutboxCompletado(uuid);
            procesados++;
          } else if (response.status === 401) {
            // 401 Unauthorized: Abortar el lote sin incrementar reintentos ni marcar error definitivo
            console.warn(
              `Sesión no autorizada o expirada (401) en registro ${uuid}. Abortando sincronización.`
            );
            abortadoPorAuth = true;
            break;
          } else if (
            response.status === 400 ||
            response.status === 409 ||
            response.status === 422
          ) {
            // 400, 409, 422: Rechazo por regla de negocio definitiva (ej: exceso de metros, fecha futura)
            // Extraer campo 'detail' del backend y marcar inmediatamente como conflicto
            let detalleConflicto = `Error de validación HTTP ${response.status}: ${response.statusText}`;
            try {
              const data = (await response.json()) as { detail?: unknown };
              if (data?.detail) {
                if (typeof data.detail === 'string') {
                  detalleConflicto = data.detail;
                } else if (Array.isArray(data.detail)) {
                  detalleConflicto = data.detail
                    .map((d: any) => d.msg || JSON.stringify(d))
                    .join('; ');
                } else {
                  detalleConflicto = JSON.stringify(data.detail);
                }
              }
            } catch {
              // Sin JSON disponible
            }

            await marcarOutboxError(uuid, detalleConflicto, true);
            errores++;
          } else {
            // 500+ u otros errores de servidor: reintento transitorio
            let errorMsg = `Error HTTP ${response.status}: ${response.statusText}`;
            try {
              const data = (await response.json()) as { detail?: unknown };
              if (data?.detail) {
                errorMsg =
                  typeof data.detail === 'string'
                    ? data.detail
                    : JSON.stringify(data.detail);
              }
            } catch {
              // Sin JSON disponible
            }

            await marcarOutboxError(uuid, errorMsg, false);
            errores++;
          }
        } catch (networkError: unknown) {
          // Fallo de red (timeout, corte de señal)
          const errorMsg =
            networkError instanceof Error
              ? networkError.message
              : 'Fallo en la conexión de red';

          await marcarOutboxError(uuid, errorMsg, false);
          errores++;
        }
      }

      if (abortadoPorAuth) {
        break;
      }
    }

    // 5. Sincronización bidireccional incremental (Pull) si no fue abortado por credenciales
    if (!abortadoPorAuth) {
      await sincronizarCambiosDesdeServidor(authToken);
    }
  } catch (error) {
    console.error('Error durante la ejecución de sincronizarLote:', error);
  } finally {
    isSyncing = false;
  }

  return { procesados, errores };
};

/**
 * Inicializa el observador de cambios de conectividad de red con NetInfo.
 * Cada vez que el dispositivo detecta conexión a internet, dispara automáticamente `sincronizarLote()`.
 *
 * @returns Función para cancelar la suscripción (cleanup en React useEffect).
 */
export const iniciarObservadorRed = (): (() => void) => {
  const unsubscribe = NetInfo.addEventListener((state) => {
    const hayConexion = Boolean(state.isConnected && state.isInternetReachable !== false);

    if (hayConexion) {
      sincronizarLote().catch((err) => {
        console.error('Error en sincronización automática reactiva de red:', err);
      });
    }
  });

  // Disparo inicial proactivo si el dispositivo ya está online al montar la aplicación
  NetInfo.fetch()
    .then((state) => {
      const hayConexion = Boolean(state.isConnected && state.isInternetReachable !== false);
      if (hayConexion) {
        sincronizarLote().catch((err) => {
          console.error('Error en sincronización inicial proactiva:', err);
        });
      }
    })
    .catch((err) => {
      console.warn('Error verificando conectividad inicial:', err);
    });

  return unsubscribe;
};
