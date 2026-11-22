import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { obtenerRegistrosRecientes } from '../db/outbox';
import { obtenerUltimoErrorOutbox, type RegistroLocal } from '../db/database';

export interface ListaRegistrosRecientesProps {
  /** Lista opcional provista externamente */
  registros?: RegistroLocal[];
  /** Señal de recarga emitida por el contenedor (por ejemplo tras guardar un nuevo registro) */
  refreshTrigger?: number;
}

/**
 * Parsea el campo de observación para extraer etiquetas entre corchetes, ej: "[Tendido de línea] Nota adicional"
 */
function parseObservacion(obs: string | null): { fase: string | null; nota: string } | null {
  if (!obs) return null;
  const match = obs.match(/^\[([^\]]+)\](?:\s*(.*))?$/);
  if (match) {
    return {
      fase: match[1],
      nota: match[2] || '',
    };
  }
  return {
    fase: null,
    nota: obs,
  };
}

/**
 * Despliega los últimos registros de avance guardados localmente.
 * Diseño industrial Dark/Slate minimalista con resaltado de fase de maniobra,
 * alertas de área designada y motivos específicos de conflicto de negocio.
 */
export function ListaRegistrosRecientes({
  registros: propRegistros,
  refreshTrigger,
}: ListaRegistrosRecientesProps) {
  const [registrosLocales, setRegistrosLocales] = useState<RegistroLocal[]>(
    propRegistros ?? []
  );
  const [erroresOutbox, setErroresOutbox] = useState<Record<string, string>>({});

  const cargarErroresConflictos = useCallback(async (items: RegistroLocal[]) => {
    const conflictos = items.filter((r) => r.estado_sync === 'conflicto');
    if (conflictos.length === 0) return;

    const nuevosErrores: Record<string, string> = {};
    for (const item of conflictos) {
      try {
        const errorMsg = await obtenerUltimoErrorOutbox(item.id);
        if (errorMsg) {
          nuevosErrores[item.id] = errorMsg;
        }
      } catch (err) {
        console.warn(`Error al consultar último error de outbox para ${item.id}:`, err);
      }
    }
    setErroresOutbox((prev) => ({ ...prev, ...nuevosErrores }));
  }, []);

  const cargarRegistros = useCallback(async () => {
    try {
      const items = await obtenerRegistrosRecientes(10);
      setRegistrosLocales(items);
      cargarErroresConflictos(items);
    } catch (err) {
      console.warn('Error al cargar registros recientes:', err);
    }
  }, [cargarErroresConflictos]);

  useEffect(() => {
    if (propRegistros !== undefined) {
      setRegistrosLocales(propRegistros);
      cargarErroresConflictos(propRegistros);
    } else {
      cargarRegistros();
    }
  }, [propRegistros, refreshTrigger, cargarRegistros, cargarErroresConflictos]);

  const formatearFechaHora = (isoDate: string): string => {
    try {
      const d = new Date(isoDate);
      if (isNaN(d.getTime())) return isoDate;
      const dia = d.getDate().toString().padStart(2, '0');
      const mes = (d.getMonth() + 1).toString().padStart(2, '0');
      const horas = d.getHours().toString().padStart(2, '0');
      const minutos = d.getMinutes().toString().padStart(2, '0');
      return `${horas}:${minutos} · ${dia}/${mes}`;
    } catch {
      return isoDate;
    }
  };

  const lista = propRegistros !== undefined ? propRegistros : registrosLocales;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Registros Recientes</Text>
        <View style={styles.countBadge}>
          <Text style={styles.countBadgeText}>{lista.length}</Text>
        </View>
      </View>

      {lista.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>Sin registros locales</Text>
          <Text style={styles.emptySubtitle}>
            Los avances guardados aparecerán aquí.
          </Text>
        </View>
      ) : (
        <View style={styles.listContainer}>
          {lista.map((reg) => {
            const esPendiente = reg.estado_sync === 'pendiente';
            const esSincronizado = reg.estado_sync === 'sincronizado';
            const esConflicto = reg.estado_sync === 'conflicto';
            const esFueraZona = reg.dentro_zona === 0;
            const parsedObs = parseObservacion(reg.observacion);

            return (
              <View key={reg.id} style={styles.itemRow}>
                {/* Columna Izquierda: Metros, Fase y Metadatos */}
                <View style={styles.itemLeftCol}>
                  <View style={styles.metrosRow}>
                    <Text style={styles.metrosText}>
                      +{reg.metros_avanzados.toFixed(1)} m
                    </Text>
                    <Text style={styles.lineaText}>Línea #{reg.linea_id}</Text>
                  </View>

                  <Text style={styles.horaText}>
                    {formatearFechaHora(reg.creado_en || reg.fecha)}
                  </Text>

                  {parsedObs?.fase ? (
                    <View style={styles.faseContainer}>
                      <View style={styles.faseTagBadge}>
                        <Text style={styles.faseTagText}>{parsedObs.fase}</Text>
                      </View>
                      {parsedObs.nota ? (
                        <Text
                          style={styles.observacionText}
                          numberOfLines={1}
                          ellipsizeMode="tail"
                        >
                          {parsedObs.nota}
                        </Text>
                      ) : null}
                    </View>
                  ) : reg.observacion ? (
                    <Text
                      style={styles.observacionText}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {reg.observacion}
                    </Text>
                  ) : null}
                </View>

                {/* Columna Derecha: Badges de Estado y Zona */}
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
                      {esPendiente && 'Pendiente'}
                      {esSincronizado && 'Sincronizado'}
                      {esConflicto && 'Conflicto'}
                    </Text>
                  </View>

                  {/* Badge destacado si el ancla/muerto fue fondeado fuera de zona */}
                  {esFueraZona && (
                    <View style={styles.zonaAlertaBadge}>
                      <Text style={styles.zonaAlertaText}>
                        Fuera de área designada
                      </Text>
                    </View>
                  )}

                  {/* Motivo real del rechazo devuelto por el servidor */}
                  {esConflicto && (
                    <Text style={styles.conflictoNotice} numberOfLines={3}>
                      {erroresOutbox[reg.id] || 'Conflicto: requiere corrección en faena'}
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
    backgroundColor: '#1e293b',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 8,
    padding: 16,
    marginBottom: 20,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    paddingBottom: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#f8fafc',
  },
  countBadge: {
    backgroundColor: '#334155',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  countBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#94a3b8',
    marginBottom: 2,
  },
  emptySubtitle: {
    fontSize: 12,
    color: '#64748b',
    textAlign: 'center',
  },
  listContainer: {
    gap: 8,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    padding: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  itemLeftCol: {
    flex: 1,
    paddingRight: 10,
  },
  metrosRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginBottom: 2,
  },
  metrosText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#f8fafc',
  },
  lineaText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#94a3b8',
  },
  horaText: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '500',
    marginBottom: 4,
  },
  faseContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  faseTagBadge: {
    backgroundColor: 'rgba(2, 132, 199, 0.15)',
    borderColor: 'rgba(56, 189, 248, 0.35)',
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  faseTagText: {
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  observacionText: {
    fontSize: 12,
    color: '#94a3b8',
    fontStyle: 'italic',
    flexShrink: 1,
  },
  itemRightCol: {
    alignItems: 'flex-end',
    maxWidth: 160,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
  },
  statusBadgePendiente: {
    backgroundColor: 'rgba(217, 119, 6, 0.15)',
    borderColor: '#d97706',
  },
  statusBadgeSincronizado: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: '#059669',
  },
  statusBadgeConflicto: {
    backgroundColor: 'rgba(220, 38, 38, 0.15)',
    borderColor: '#dc2626',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  statusTextPendiente: {
    color: '#fbbf24',
  },
  statusTextSincronizado: {
    color: '#34d399',
  },
  statusTextConflicto: {
    color: '#f87171',
  },
  zonaAlertaBadge: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderColor: 'rgba(239, 68, 68, 0.45)',
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 4,
  },
  zonaAlertaText: {
    color: '#fca5a5',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.2,
    textAlign: 'right',
  },
  conflictoNotice: {
    fontSize: 10,
    color: '#f87171',
    fontWeight: '600',
    marginTop: 4,
    textAlign: 'right',
    lineHeight: 13,
  },
});
