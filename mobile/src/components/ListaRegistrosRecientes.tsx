import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { obtenerRegistrosRecientes } from '../db/outbox';
import type { RegistroLocal } from '../db/database';

export interface ListaRegistrosRecientesProps {
  /** Lista opcional provista externamente */
  registros?: RegistroLocal[];
  /** Señal de recarga emitida por el contenedor (por ejemplo tras guardar un nuevo registro) */
  refreshTrigger?: number;
}

/**
 * Despliega los últimos registros de avance capturados en terreno con sus respectivos
 * estados de sincronización: Pendiente, Sincronizado o Conflicto.
 */
export function ListaRegistrosRecientes({
  registros: propRegistros,
  refreshTrigger,
}: ListaRegistrosRecientesProps) {
  const [registrosLocales, setRegistrosLocales] = useState<RegistroLocal[]>(
    propRegistros ?? []
  );

  const cargarRegistros = useCallback(async () => {
    try {
      const items = await obtenerRegistrosRecientes(10);
      setRegistrosLocales(items);
    } catch (err) {
      console.warn('Error al cargar registros recientes:', err);
    }
  }, []);

  useEffect(() => {
    if (propRegistros !== undefined) {
      setRegistrosLocales(propRegistros);
    } else {
      cargarRegistros();
    }
  }, [propRegistros, refreshTrigger, cargarRegistros]);

  const formatearFechaHora = (isoDate: string): string => {
    try {
      const d = new Date(isoDate);
      if (isNaN(d.getTime())) return isoDate;
      const dia = d.getDate().toString().padStart(2, '0');
      const mes = (d.getMonth() + 1).toString().padStart(2, '0');
      const horas = d.getHours().toString().padStart(2, '0');
      const minutos = d.getMinutes().toString().padStart(2, '0');
      return `${horas}:${minutos} hrs (${dia}/${mes})`;
    } catch {
      return isoDate;
    }
  };

  const lista = propRegistros !== undefined ? propRegistros : registrosLocales;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Registros Recientes en Terreno</Text>
        <View style={styles.countBadge}>
          <Text style={styles.countBadgeText}>{lista.length}</Text>
        </View>
      </View>

      {lista.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>📋</Text>
          <Text style={styles.emptyTitle}>Sin registros locales aún</Text>
          <Text style={styles.emptySubtitle}>
            Usa el formulario superior para capturar el primer avance.
          </Text>
        </View>
      ) : (
        <View style={styles.listContainer}>
          {lista.map((reg) => {
            const esPendiente = reg.estado_sync === 'pendiente';
            const esSincronizado = reg.estado_sync === 'sincronizado';
            const esConflicto = reg.estado_sync === 'conflicto';

            return (
              <View key={reg.id} style={styles.itemRow}>
                {/* Columna Izquierda: Metros y Metadatos */}
                <View style={styles.itemLeftCol}>
                  <View style={styles.metrosRow}>
                    <Text style={styles.metrosText}>
                      +{reg.metros_avanzados.toFixed(1)} m
                    </Text>
                    <Text style={styles.lineaText}>Línea #{reg.linea_id}</Text>
                  </View>

                  <Text style={styles.horaText}>
                    🕒 {formatearFechaHora(reg.creado_en || reg.fecha)}
                  </Text>

                  {reg.observacion ? (
                    <Text
                      style={styles.observacionText}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      📝 {reg.observacion}
                    </Text>
                  ) : null}
                </View>

                {/* Columna Derecha: Badge de Estado */}
                <View style={styles.itemRightCol}>
                  <View
                    style={[
                      styles.statusBadge,
                      esPendiente && styles.statusBadgePendiente,
                      esSincronizado && styles.statusBadgeSincronizado,
                      esConflicto && styles.statusBadgeConflicto,
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusBadgeText,
                        esPendiente && styles.statusTextPendiente,
                        esSincronizado && styles.statusTextSincronizado,
                        esConflicto && styles.statusTextConflicto,
                      ]}
                    >
                      {esPendiente && '⏳ Pendiente'}
                      {esSincronizado && '✓ Sincronizado'}
                      {esConflicto && '⚠️ Conflicto'}
                    </Text>
                  </View>

                  {esConflicto && (
                    <Text style={styles.conflictoNotice}>
                      Requiere revisión en oficina
                    </Text>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 18,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    paddingBottom: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  countBadge: {
    backgroundColor: '#e2e8f0',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  countBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  emptyIcon: {
    fontSize: 32,
    marginBottom: 6,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 2,
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
  },
  listContainer: {
    gap: 12,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  itemLeftCol: {
    flex: 1,
    paddingRight: 10,
  },
  metrosRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginBottom: 3,
  },
  metrosText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  lineaText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
  },
  horaText: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '500',
    marginBottom: 2,
  },
  observacionText: {
    fontSize: 12,
    color: '#475569',
    fontStyle: 'italic',
  },
  itemRightCol: {
    alignItems: 'flex-end',
  },
  statusBadge: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  statusBadgePendiente: {
    backgroundColor: '#fef3c7',
    borderColor: '#f59e0b',
  },
  statusBadgeSincronizado: {
    backgroundColor: '#dcfce7',
    borderColor: '#10b981',
  },
  statusBadgeConflicto: {
    backgroundColor: '#fee2e2',
    borderColor: '#ef4444',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  statusTextPendiente: {
    color: '#b45309',
  },
  statusTextSincronizado: {
    color: '#15803d',
  },
  statusTextConflicto: {
    color: '#b91c1c',
  },
  conflictoNotice: {
    fontSize: 10,
    color: '#dc2626',
    fontWeight: '600',
    marginTop: 3,
    textAlign: 'right',
  },
});

