import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useNetInfo } from '@react-native-community/netinfo';
import {
  getDB,
  obtenerLineasCache,
  obtenerMetaSync,
  type LineaCache,
  type OutboxItem,
} from '../db/database';
import { sincronizarLote, isSyncActive } from '../sync/syncManager';

interface OutboxResumen {
  pendientes: number;
  conflictos: number;
  fallidos: number;
}

export default function DiagnosticoSyncScreen() {
  const netInfo = useNetInfo();
  const isOnline = Boolean(netInfo.isConnected && netInfo.isInternetReachable !== false);

  const [loading, setLoading] = useState<boolean>(true);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [resumen, setResumen] = useState<OutboxResumen>({
    pendientes: 0,
    conflictos: 0,
    fallidos: 0,
  });
  const [outboxItems, setOutboxItems] = useState<OutboxItem[]>([]);
  const [lineas, setLineas] = useState<LineaCache[]>([]);
  const [cursorPull, setCursorPull] = useState<string | null>(null);

  const cargarDiagnostico = useCallback(async () => {
    try {
      const db = getDB();

      // 1. Conteo de ítems en outbox agrupados por estado
      const rows = await db.getAllAsync<{ estado: string; total: number }>(
        `SELECT estado, COUNT(*) as total FROM outbox GROUP BY estado`
      );

      let pendientes = 0;
      let conflictos = 0;
      let fallidos = 0;

      for (const row of rows) {
        if (row.estado === 'pendiente') pendientes = row.total;
        else if (row.estado === 'conflicto') conflictos = row.total;
        else if (row.estado === 'fallido') fallidos = row.total;
      }
      setResumen({ pendientes, conflictos, fallidos });

      // 2. Elementos en outbox con error o pendientes (máximo 15)
      const items = await db.getAllAsync<OutboxItem>(
        `SELECT id, uuid, metodo, endpoint, payload, estado, reintentos, creado_en, ultimo_error
         FROM outbox
         ORDER BY id DESC
         LIMIT 15`
      );
      setOutboxItems(items);

      // 3. Líneas en caché
      const lineasData = await obtenerLineasCache();
      setLineas(lineasData);

      // 4. Cursor de última sincronización pull
      const cursor = await obtenerMetaSync('ultima_sincronizacion_pull');
      setCursorPull(cursor);
    } catch (err) {
      console.error('Error al cargar datos de diagnóstico:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cargarDiagnostico();
  }, [cargarDiagnostico]);

  const handleForzarSincronizacion = async () => {
    if (syncing || isSyncActive()) return;
    setSyncing(true);
    try {
      await sincronizarLote();
      await cargarDiagnostico();
    } catch (err) {
      console.error('Error durante la sincronización forzada:', err);
    } finally {
      setSyncing(false);
    }
  };

  const formatearFecha = (iso: string | null) => {
    if (!iso) return 'Nunca';
    try {
      const d = new Date(iso);
      return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
    } catch {
      return iso;
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={cargarDiagnostico}
            tintColor="#38bdf8"
          />
        }
      >
        {/* Cabecera */}
        <View style={styles.header}>
          <Text style={styles.title}>Diagnóstico y Sincronización</Text>
          <Text style={styles.subtitle}>
            Estado de colas offline, validación de zonas y cursor de datos
          </Text>
        </View>

        {/* Tarjeta de Conectividad */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View
              style={[
                styles.dot,
                { backgroundColor: isOnline ? '#22c55e' : '#ef4444' },
              ]}
            />
            <Text style={styles.cardTitle}>
              {isOnline ? 'Conexión Activa' : 'Modo Fuera de Línea'}
            </Text>
          </View>
          <Text style={styles.cardDescription}>
            {isOnline
              ? 'El dispositivo tiene enlace activo con el servidor central.'
              : 'Las capturas se resguardan en SQLite local hasta recuperar conectividad.'}
          </Text>
          <Text style={styles.metaText}>
            Último Pull Servidor: {formatearFecha(cursorPull)}
          </Text>
        </View>

        {/* Resumen de Cola Outbox */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Cola de Salida (Transactional Outbox)</Text>
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={[styles.statValue, { color: '#38bdf8' }]}>
                {resumen.pendientes}
              </Text>
              <Text style={styles.statLabel}>Pendientes</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={[styles.statValue, { color: '#ef4444' }]}>
                {resumen.conflictos}
              </Text>
              <Text style={styles.statLabel}>Conflictos</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={[styles.statValue, { color: '#f59e0b' }]}>
                {resumen.fallidos}
              </Text>
              <Text style={styles.statLabel}>Reintentos</Text>
            </View>
          </View>

          {outboxItems.length > 0 && (
            <View style={styles.outboxList}>
              <Text style={styles.sectionSub}>Detalle de Eventos:</Text>
              {outboxItems.map((item) => (
                <View key={item.id} style={styles.itemCard}>
                  <View style={styles.itemHeader}>
                    <Text style={styles.itemUuid} numberOfLines={1}>
                      {item.uuid}
                    </Text>
                    <View
                      style={[
                        styles.badge,
                        item.estado === 'conflicto'
                          ? styles.badgeError
                          : item.estado === 'pendiente'
                          ? styles.badgePending
                          : styles.badgeRetry,
                      ]}
                    >
                      <Text style={styles.badgeText}>{item.estado}</Text>
                    </View>
                  </View>
                  {item.ultimo_error && (
                    <Text style={styles.errorText} numberOfLines={2}>
                      Error: {item.ultimo_error}
                    </Text>
                  )}
                  <Text style={styles.metaSubText}>
                    Reintentos: {item.reintentos} · Creado: {formatearFecha(item.creado_en)}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Líneas de Fondeo en Caché */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Líneas en Caché Local ({lineas.length})</Text>
          </View>
          {lineas.length === 0 ? (
            <Text style={styles.emptyText}>
              No hay líneas cacheadas. Realiza una sincronización para descargar geometrías.
            </Text>
          ) : (
            lineas.map((linea) => (
              <View key={linea.id} style={styles.lineaRow}>
                <View style={styles.lineaInfo}>
                  <Text style={styles.lineaNombre}>{linea.nombre}</Text>
                  <Text style={styles.metaSubText}>
                    ID: {linea.id} · Meta: {linea.metros_totales ?? 0}m · Radio: {linea.radio_tolerancia_m ?? 50}m
                  </Text>
                </View>
                <View
                  style={[
                    styles.badge,
                    linea.estado === 'completada' ? styles.badgeSuccess : styles.badgeActive,
                  ]}
                >
                  <Text style={styles.badgeText}>{linea.estado ?? 'activa'}</Text>
                </View>
              </View>
            ))
          )}
        </View>

        {/* Acciones */}
        <TouchableOpacity
          style={[styles.primaryButton, (!isOnline || syncing) && styles.buttonDisabled]}
          onPress={handleForzarSincronizacion}
          disabled={!isOnline || syncing}
        >
          {syncing ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.primaryButtonText}>Sincronizar Lote (Push/Pull)</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => router.replace('/')}
        >
          <Text style={styles.secondaryButtonText}>Volver a Captura</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  container: {
    padding: 16,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#f8fafc',
  },
  subtitle: {
    fontSize: 13,
    color: '#94a3b8',
    marginTop: 4,
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#f1f5f9',
  },
  cardDescription: {
    fontSize: 13,
    color: '#cbd5e1',
    lineHeight: 18,
  },
  metaText: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 8,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 12,
    marginBottom: 12,
  },
  statBox: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },
  sectionSub: {
    fontSize: 13,
    fontWeight: '600',
    color: '#94a3b8',
    marginTop: 8,
    marginBottom: 8,
  },
  outboxList: {
    marginTop: 8,
  },
  itemCard: {
    backgroundColor: '#0f172a',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemUuid: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: '#38bdf8',
    flex: 1,
    marginRight: 8,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgePending: {
    backgroundColor: '#0369a1',
  },
  badgeError: {
    backgroundColor: '#b91c1c',
  },
  badgeRetry: {
    backgroundColor: '#b45309',
  },
  badgeSuccess: {
    backgroundColor: '#15803d',
  },
  badgeActive: {
    backgroundColor: '#1e3a5f',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#ffffff',
    textTransform: 'uppercase',
  },
  errorText: {
    fontSize: 12,
    color: '#f87171',
    marginTop: 4,
  },
  metaSubText: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 4,
  },
  emptyText: {
    fontSize: 13,
    color: '#64748b',
    fontStyle: 'italic',
    marginTop: 6,
  },
  lineaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  lineaInfo: {
    flex: 1,
  },
  lineaNombre: {
    fontSize: 14,
    fontWeight: '600',
    color: '#f8fafc',
  },
  primaryButton: {
    backgroundColor: '#0284c7',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  buttonDisabled: {
    backgroundColor: '#475569',
    opacity: 0.7,
  },
  secondaryButton: {
    backgroundColor: '#1e293b',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  secondaryButtonText: {
    color: '#cbd5e1',
    fontSize: 15,
    fontWeight: '500',
  },
});
