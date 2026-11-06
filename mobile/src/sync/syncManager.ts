import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import * as SecureStore from 'expo-secure-store';
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
 * Retorna true si actualmente hay un lote de sincronización en progreso.
 */
export const isSyncActive = (): boolean => isSyncing;

/**
 * Procesa la cola Outbox en estricto orden cronológico FIFO enviando
 * las peticiones HTTP idempotentes (PUT /registros/{uuid}) hacia el backend.
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

  try {
    // 3. Obtener lote de ítems pendientes en orden FIFO (ORDER BY creado_en ASC)
    const pendientes = await obtenerOutboxPendientes(10);
    if (pendientes.length === 0) {
      return { procesados: 0, errores: 0 };
    }

    // 4. Obtener token de autenticación si existe sesión activa guardada
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

    // 5. Procesamiento estrictamente secuencial para garantizar orden FIFO
    for (const item of pendientes) {
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
        } else if (response.status === 409) {
          // 409 Conflict: Inconsistencia o regla de negocio rechazada por el backend
          let detalleConflicto = 'Conflicto de sincronización (409)';
          try {
            const data = (await response.json()) as { detail?: string };
            if (data?.detail) {
              detalleConflicto = `Conflicto (409): ${data.detail}`;
            }
          } catch {
            // No viene payload JSON
          }

          await marcarOutboxError(uuid, detalleConflicto, true);
          errores++;
        } else {
          // 400, 422, 500 u otros errores del servidor: registrar y reintentar luego
          let errorMsg = `Error HTTP ${response.status}: ${response.statusText}`;
          try {
            const data = (await response.json()) as { detail?: unknown };
            if (data?.detail) {
              errorMsg = `Error HTTP ${response.status}: ${
                typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail)
              }`;
            }
          } catch {
            // No viene payload JSON
          }

          await marcarOutboxError(uuid, errorMsg, false);
          errores++;
        }
      } catch (networkError: unknown) {
        // Fallo de red (timeout, corte de señal, TypeError)
        const errorMsg =
          networkError instanceof Error ? networkError.message : 'Fallo en la conexión de red';

        await marcarOutboxError(uuid, errorMsg, false);
        errores++;
      }
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
