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
 * Barra superior reactiva de conectividad y estado de cola Outbox.
 * Diseño industrial Dark/Slate minimalista.
 */
export function SyncStatusBar({
  pendientes: propPendientes,
  onSyncComplete,
}: SyncStatusBarProps) {
  const netInfo = useNetInfo();
  const [conteoLocal, setConteoLocal] = useState<number>(propPendientes ?? 0);
  const [isSyncingLocal, setIsSyncingLocal] = useState<boolean>(false);

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
      {/* Alerta de modo sin conexión */}
      {isOffline && (
        <View style={styles.offlineBanner}>
          <View style={styles.offlineDot} />
          <Text style={styles.offlineBannerText}>
            Modo sin conexión · Los registros se guardan en el dispositivo
          </Text>
        </View>
      )}

      {/* Estado de sincronización */}
      <View style={styles.statusRow}>
        <View style={styles.statusLeft}>
          <View
            style={[
              styles.statusDot,
              cantidadPendientes > 0
                ? styles.statusDotPending
                : styles.statusDotSynced,
            ]}
          />
          <Text style={styles.statusText}>
            {cantidadPendientes > 0 ? (
              <>
                <Text style={styles.pendingNumber}>{cantidadPendientes}</Text>{' '}
                {cantidadPendientes === 1
                  ? 'pendiente de sincronizar'
                  : 'pendientes de sincronizar'}
              </>
            ) : (
              'Todo sincronizado'
            )}
          </Text>
        </View>

        {cantidadPendientes > 0 && (
          <TouchableOpacity
            style={[
              styles.syncButton,
              (isSyncingLocal || isOffline) && styles.syncButtonDisabled,
            ]}
            onPress={handleSincronizarManual}
            disabled={isSyncingLocal || isOffline}
            activeOpacity={0.7}
          >
            {isSyncingLocal ? (
              <ActivityIndicator size="small" color="#f8fafc" />
            ) : (
              <Text style={styles.syncButtonText}>
                {isOffline ? 'Sin red' : 'Sincronizar'}
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
    backgroundColor: '#78350f',
    borderColor: '#b45309',
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  offlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#fbbf24',
    marginRight: 8,
  },
  offlineBannerText: {
    color: '#fef3c7',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1e293b',
    borderColor: '#334155',
    borderWidth: 1,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  statusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  statusDotPending: {
    backgroundColor: '#f59e0b',
  },
  statusDotSynced: {
    backgroundColor: '#10b981',
  },
  statusText: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '500',
  },
  pendingNumber: {
    color: '#f8fafc',
    fontWeight: '700',
  },
  syncButton: {
    backgroundColor: '#334155',
    borderColor: '#475569',
    borderWidth: 1,
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 5,
    minHeight: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  syncButtonDisabled: {
    opacity: 0.5,
  },
  syncButtonText: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '600',
  },
});
