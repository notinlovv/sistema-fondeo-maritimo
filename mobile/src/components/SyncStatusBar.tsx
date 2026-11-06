import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useNetInfo } from '@react-native-community/netinfo';
import { contarRegistrosPendientes } from '../db/outbox';
import { sincronizarLote, isSyncActive } from '../sync/syncManager';

export interface SyncStatusBarProps {
  /** Cantidad de registros pendientes inyectada por el componente contenedor */
  pendientes?: number;
  /** Callback invocado tras completar una sincronización manual */
  onSyncComplete?: () => void;
}

/**
 * Barra reactiva superior que alerta sobre la falta de conexión y
 * muestra el contador de transacciones encoladas en Outbox con opción de sincronización manual.
 */
export function SyncStatusBar({
  pendientes: propPendientes,
  onSyncComplete,
}: SyncStatusBarProps) {
  const netInfo = useNetInfo();
  const [conteoLocal, setConteoLocal] = useState<number>(propPendientes ?? 0);
  const [isSyncingLocal, setIsSyncingLocal] = useState<boolean>(false);

  // Considerar offline si explícitamente isConnected o isInternetReachable es false
  const isOffline =
    netInfo.isConnected === false || netInfo.isInternetReachable === false;

  const refrescarConteo = useCallback(async () => {
    try {
      const count = await contarRegistrosPendientes();
      setConteoLocal(count);
    } catch (err) {
      console.warn('Error al consultar registros pendientes:', err);
    }
  }, []);

  useEffect(() => {
    if (propPendientes !== undefined) {
      setConteoLocal(propPendientes);
    } else {
      refrescarConteo();
    }
  }, [propPendientes, refrescarConteo]);

  useEffect(() => {
    if (netInfo.isConnected && !isOffline) {
      refrescarConteo();
    }
  }, [netInfo.isConnected, isOffline, refrescarConteo]);

  const handleSincronizarManual = async () => {
    if (isSyncingLocal || isSyncActive() || isOffline) return;
    setIsSyncingLocal(true);
    try {
      await sincronizarLote();
      await refrescarConteo();
      onSyncComplete?.();
    } catch (err) {
      console.error('Error al sincronizar manualmente:', err);
    } finally {
      setIsSyncingLocal(false);
    }
  };

  const cantidadPendientes =
    propPendientes !== undefined ? propPendientes : conteoLocal;

  return (
    <View style={styles.container}>
      {/* Banner de alerta visual cuando no hay conectividad (HU-02) */}
      {isOffline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerIcon}>⚠️</Text>
          <Text style={styles.offlineBannerText}>
            Modo sin conexión - Los registros se guardan en el dispositivo
          </Text>
        </View>
      )}

      {/* Píldora de estado de la cola de sincronización */}
      <View
        style={[
          styles.statusRow,
          cantidadPendientes > 0 ? styles.statusRowPending : styles.statusRowSynced,
        ]}
      >
        <View style={styles.statusInfoCol}>
          {cantidadPendientes > 0 ? (
            <View style={styles.pendingBadgeRow}>
              <Text style={styles.pendingIcon}>☁️</Text>
              <Text style={styles.pendingText}>
                <Text style={styles.pendingCount}>{cantidadPendientes}</Text>{' '}
                {cantidadPendientes === 1
                  ? 'pendiente por sincronizar'
                  : 'pendientes por sincronizar'}
              </Text>
            </View>
          ) : (
            <View style={styles.syncedBadgeRow}>
              <Text style={styles.syncedIcon}>✓</Text>
              <Text style={styles.syncedText}>Todo sincronizado</Text>
            </View>
          )}
        </View>

        {/* Botón táctil para sincronizar inmediatamente si hay pendientes */}
        {cantidadPendientes > 0 && (
          <TouchableOpacity
            style={[
              styles.syncNowButton,
              (isSyncingLocal || isOffline) && styles.syncNowButtonDisabled,
            ]}
            onPress={handleSincronizarManual}
            disabled={isSyncingLocal || isOffline}
            activeOpacity={0.8}
          >
            {isSyncingLocal ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.syncNowButtonText}>
                {isOffline ? 'Sin red' : 'Sincronizar ahora'}
              </Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 12,
  },
  offlineBanner: {
    backgroundColor: '#b45309', // Ámbar / naranja de alta visibilidad
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#d97706',
  },
  offlineBannerIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  offlineBannerText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
    lineHeight: 18,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
  },
  statusRowPending: {
    backgroundColor: '#1e293b',
    borderColor: '#f59e0b',
  },
  statusRowSynced: {
    backgroundColor: '#064e3b',
    borderColor: '#10b981',
  },
  statusInfoCol: {
    flex: 1,
  },
  pendingBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pendingIcon: {
    fontSize: 15,
    marginRight: 6,
  },
  pendingText: {
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '600',
  },
  pendingCount: {
    color: '#f59e0b',
    fontWeight: '800',
  },
  syncedBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  syncedIcon: {
    fontSize: 15,
    color: '#34d399',
    fontWeight: '900',
    marginRight: 6,
  },
  syncedText: {
    color: '#34d399',
    fontSize: 14,
    fontWeight: '700',
  },
  syncNowButton: {
    backgroundColor: '#2563eb',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 6,
    marginLeft: 10,
    minHeight: 34,
    justifyContent: 'center',
    alignItems: 'center',
  },
  syncNowButtonDisabled: {
    backgroundColor: '#475569',
  },
  syncNowButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
});

