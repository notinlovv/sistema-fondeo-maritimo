import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useForm, Controller } from 'react-hook-form';
import * as Location from 'expo-location';
import uuid from 'react-native-uuid';
import { guardarRegistroYEncolar, contarRegistrosPendientes } from '../db/outbox';
import { registroSchema } from '../schemas/registro';
import { sincronizarLote } from '../sync/syncManager';
import { SyncStatusBar } from '../components/SyncStatusBar';
import { ListaRegistrosRecientes } from '../components/ListaRegistrosRecientes';

interface FormInputValues {
  linea_id: number;
  metros_avanzados: string;
  observacion: string;
}

type GpsState = 'iniciando' | 'buscando' | 'fijado' | 'denegado' | 'error';

const FASES_MANIOBRA = [
  'Tendido de línea',
  'Tensado y ajuste',
  'Conexión a ancla / muerto',
  'Inspección de tramo',
] as const;

type FaseManiobra = (typeof FASES_MANIOBRA)[number];

// Coordenadas base de referencia para operaciones bajo cubierta o sin señal
const FALLBACK_COORDS = { latitude: -41.4693, longitude: -72.9424 };

export default function CapturaTerrenoScreen() {
  const [gpsStatus, setGpsStatus] = useState<GpsState>('iniciando');
  const [coords, setCoords] = useState<{ latitude: number | null; longitude: number | null }>({
    latitude: null,
    longitude: null,
  });
  const [isRefreshingGps, setIsRefreshingGps] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [pendientesCount, setPendientesCount] = useState<number>(0);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);

  // Selector de fase de maniobra
  const [faseSeleccionada, setFaseSeleccionada] =
    useState<FaseManiobra>('Tendido de línea');
  const [modalFaseVisible, setModalFaseVisible] = useState<boolean>(false);

  const metrosInputRef = useRef<TextInput>(null);

  const {
    control,
    handleSubmit,
    setError,
    clearErrors,
    reset,
    formState: { errors },
  } = useForm<FormInputValues>({
    defaultValues: {
      linea_id: 1,
      metros_avanzados: '',
      observacion: '',
    },
  });

  const refrescarContadorPendientes = useCallback(async () => {
    try {
      const count = await contarRegistrosPendientes();
      setPendientesCount(count);
    } catch (err) {
      console.warn('Error al leer registros pendientes:', err);
    }
  }, []);

  const recargarTodo = useCallback(async () => {
    await refrescarContadorPendientes();
    setRefreshTrigger((prev) => prev + 1);
  }, [refrescarContadorPendientes]);

  const capturarCoordenadasGPS = async () => {
    setIsRefreshingGps(true);
    setGpsStatus('buscando');

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setGpsStatus('denegado');
        setCoords((prev) => (prev.latitude !== null ? prev : FALLBACK_COORDS));
        return;
      }

      // Intentar posición actual con timeout de seguridad
      const location = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
      ]);

      if (location) {
        const { latitude, longitude } = location.coords;
        setCoords({ latitude, longitude });
        setGpsStatus('fijado');
      } else {
        const lastKnown = await Location.getLastKnownPositionAsync();
        if (lastKnown) {
          setCoords({
            latitude: lastKnown.coords.latitude,
            longitude: lastKnown.coords.longitude,
          });
          setGpsStatus('fijado');
        } else {
          setCoords((prev) => (prev.latitude !== null ? prev : FALLBACK_COORDS));
          setGpsStatus('error');
        }
      }
    } catch {
      setGpsStatus('error');
      setCoords((prev) => (prev.latitude !== null ? prev : FALLBACK_COORDS));
    } finally {
      setIsRefreshingGps(false);
    }
  };

  useEffect(() => {
    capturarCoordenadasGPS();
    refrescarContadorPendientes();
  }, [refrescarContadorPendientes]);

  const onPullToRefresh = async () => {
    setRefreshing(true);
    try {
      await sincronizarLote();
      await recargarTodo();
    } catch (err) {
      console.warn('Error durante pull to refresh:', err);
    } finally {
      setRefreshing(false);
    }
  };

  const generarUUID = (): string => {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
    return uuid.v4() as string;
  };

  const onSubmit = async (data: FormInputValues) => {
    const latitudFinal = coords.latitude ?? FALLBACK_COORDS.latitude;
    const longitudFinal = coords.longitude ?? FALLBACK_COORDS.longitude;

    const metrosLimpios = data.metros_avanzados.trim().replace(',', '.');
    const metrosNumero = parseFloat(metrosLimpios);

    // Integración transparente: se concatena la fase seleccionada con la observación
    const obsLimpia = data.observacion?.trim();
    const observacionFinal = obsLimpia
      ? `[${faseSeleccionada}] ${obsLimpia}`
      : `[${faseSeleccionada}]`;

    const validacion = registroSchema.safeParse({
      linea_id: data.linea_id,
      metros_avanzados: isNaN(metrosNumero) ? undefined : metrosNumero,
      latitud: latitudFinal,
      longitud: longitudFinal,
      observacion: observacionFinal,
    });

    if (!validacion.success) {
      const issues = validacion.error.issues;
      const metrosIssue = issues.find((issue) => issue.path[0] === 'metros_avanzados');
      if (metrosIssue) {
        setError('metros_avanzados', {
          type: 'manual',
          message: metrosIssue.message,
        });
      }
      return;
    }

    clearErrors('metros_avanzados');
    setIsSaving(true);

    try {
      const nuevoUUID = generarUUID();
      const fechaISO = new Date().toISOString();

      await guardarRegistroYEncolar({
        id: nuevoUUID,
        linea_id: validacion.data.linea_id,
        usuario_id: 1,
        metros_avanzados: validacion.data.metros_avanzados,
        fecha: fechaISO,
        latitud: validacion.data.latitud,
        longitud: validacion.data.longitud,
        estado: 'activa',
        observacion: validacion.data.observacion ?? null,
      });

      Alert.alert('Registro Guardado', 'El avance fue almacenado localmente');

      reset({
        linea_id: 1,
        metros_avanzados: '',
        observacion: '',
      });
      setFaseSeleccionada('Tendido de línea');

      await recargarTodo();

      sincronizarLote()
        .then(() => recargarTodo())
        .catch(() => {});
    } catch (error) {
      console.error('Error al guardar registro local:', error);
      Alert.alert(
        'Error',
        'No se pudo persistir el registro en la base de datos local. Intente nuevamente.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.keyboardContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onPullToRefresh}
              tintColor="#38bdf8"
              colors={['#0284c7', '#10b981']}
            />
          }
        >
          {/* Encabezado 100% Limpio */}
          <View style={styles.header}>
            <Text style={styles.appTitle}>Registro de Fondeo</Text>
          </View>

          {/* Barra de Conectividad y Cola Outbox */}
          <SyncStatusBar
            pendientes={pendientesCount}
            onSyncComplete={recargarTodo}
          />

          {/* Consola Operativa de Faena (Instrumental Plano y Continuo) */}
          <View style={styles.instrumentPanel}>
            {/* Franja Superior de Telemetría (Línea + GPS Unificados) */}
            <View style={styles.telemetryBar}>
              <View style={styles.telemetryLeft}>
                <Text style={styles.telemetryLabel}>LÍNEA</Text>
                <Text style={styles.telemetryValue}>Línea Piloto #1</Text>
              </View>

              <View style={styles.telemetryDivider} />

              <View style={styles.telemetryRight}>
                <View style={styles.telemetryGpsRow}>
                  <View
                    style={[
                      styles.telemetryDot,
                      gpsStatus === 'fijado' && styles.telemetryDotOk,
                      (gpsStatus === 'buscando' || gpsStatus === 'iniciando') &&
                        styles.telemetryDotSearching,
                      (gpsStatus === 'error' || gpsStatus === 'denegado') &&
                        styles.telemetryDotOff,
                    ]}
                  />
                  <Text style={styles.telemetryGpsStatus}>
                    {gpsStatus === 'fijado' && 'GPS OK'}
                    {(gpsStatus === 'buscando' || gpsStatus === 'iniciando') &&
                      'Buscando...'}
                    {gpsStatus === 'denegado' && 'Base'}
                    {gpsStatus === 'error' && 'Sin señal'}
                  </Text>
                  <TouchableOpacity
                    style={styles.telemetryRefreshButton}
                    onPress={capturarCoordenadasGPS}
                    disabled={isRefreshingGps}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    {isRefreshingGps ? (
                      <ActivityIndicator size="small" color="#64748b" />
                    ) : (
                      <Text style={styles.telemetryRefreshText}>↻</Text>
                    )}
                  </TouchableOpacity>
                </View>
                <Text style={styles.telemetryCoords}>
                  {coords.latitude !== null && coords.longitude !== null
                    ? `${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`
                    : `${FALLBACK_COORDS.latitude.toFixed(4)}, ${FALLBACK_COORDS.longitude.toFixed(4)}`}
                </Text>
              </View>
            </View>

            {/* Display Numérico Héroe (Metros Avanzados) */}
            <TouchableOpacity
              style={styles.heroDisplay}
              activeOpacity={0.9}
              onPress={() => metrosInputRef.current?.focus()}
            >
              <Text style={styles.heroCaption}>AVANCE DE FAENA</Text>
              <View style={styles.heroValueRow}>
                <Controller
                  control={control}
                  name="metros_avanzados"
                  render={({ field: { onChange, onBlur, value } }) => (
                    <TextInput
                      ref={metrosInputRef}
                      style={[
                        styles.heroInput,
                        errors.metros_avanzados && styles.heroInputError,
                      ]}
                      placeholder="0.0"
                      placeholderTextColor="#334155"
                      keyboardType="decimal-pad"
                      onBlur={onBlur}
                      onChangeText={(val) => {
                        onChange(val);
                        if (errors.metros_avanzados) {
                          clearErrors('metros_avanzados');
                        }
                      }}
                      value={value}
                      selectTextOnFocus
                    />
                  )}
                />
                <Text style={styles.heroUnit}>METROS</Text>
              </View>
              {errors.metros_avanzados ? (
                <Text style={styles.errorText}>
                  {errors.metros_avanzados.message}
                </Text>
              ) : (
                <Text style={styles.heroHelper}>Toca para ingresar avance</Text>
              )}
            </TouchableOpacity>

            {/* Selector Táctil de Fase de Maniobra */}
            <TouchableOpacity
              style={styles.faseSelectorBar}
              activeOpacity={0.7}
              onPress={() => setModalFaseVisible(true)}
            >
              <View style={styles.faseSelectorInfo}>
                <Text style={styles.faseSelectorLabel}>FASE DE MANIOBRA</Text>
                <Text style={styles.faseSelectorText}>{faseSeleccionada}</Text>
              </View>
              <View style={styles.faseSelectorChevron}>
                <Text style={styles.faseSelectorChevronText}>▾</Text>
              </View>
            </TouchableOpacity>

            {/* Bitácora / Observación simplificada */}
            <View style={styles.observationBlock}>
              <Controller
                control={control}
                name="observacion"
                render={({ field: { onChange, onBlur, value } }) => (
                  <TextInput
                    style={styles.observationInput}
                    placeholder="Nota de maniobra o bitácora de campo (opcional)..."
                    placeholderTextColor="#475569"
                    multiline
                    numberOfLines={2}
                    textAlignVertical="top"
                    onBlur={onBlur}
                    onChangeText={onChange}
                    value={value}
                    maxLength={500}
                  />
                )}
              />
            </View>

            {/* Gatillo / Botón de Acción Directo */}
            <TouchableOpacity
              style={[
                styles.actionTrigger,
                isSaving && styles.actionTriggerDisabled,
              ]}
              onPress={handleSubmit(onSubmit)}
              disabled={isSaving}
              activeOpacity={0.8}
            >
              {isSaving ? (
                <ActivityIndicator color="#ffffff" size="small" />
              ) : (
                <Text style={styles.actionTriggerText}>REGISTRAR AVANCE</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Registros Recientes */}
          <ListaRegistrosRecientes refreshTrigger={refreshTrigger} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Modal de Selección Rápida de Fase (Diseñado para uso con guantes) */}
      <Modal
        visible={modalFaseVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalFaseVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setModalFaseVisible(false)}
        >
          <View style={styles.modalCard} onStartShouldSetResponder={() => true}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>FASE DE MANIOBRA</Text>
              <TouchableOpacity
                onPress={() => setModalFaseVisible(false)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalOptionsContainer}>
              {FASES_MANIOBRA.map((fase) => {
                const isSelected = fase === faseSeleccionada;
                return (
                  <TouchableOpacity
                    key={fase}
                    style={[
                      styles.modalOptionButton,
                      isSelected && styles.modalOptionButtonSelected,
                    ]}
                    activeOpacity={0.7}
                    onPress={() => {
                      setFaseSeleccionada(fase);
                      setModalFaseVisible(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.modalOptionText,
                        isSelected && styles.modalOptionTextSelected,
                      ]}
                    >
                      {fase}
                    </Text>
                    {isSelected ? (
                      <Text style={styles.modalOptionCheck}>✓</Text>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#090d16',
  },
  keyboardContainer: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 36,
  },
  header: {
    marginBottom: 8,
    marginTop: 2,
  },
  appTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f8fafc',
    letterSpacing: -0.3,
  },
  instrumentPanel: {
    backgroundColor: '#111827',
    borderColor: '#1e293b',
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 16,
  },
  telemetryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
    backgroundColor: '#0c1220',
  },
  telemetryLeft: {
    flex: 1,
  },
  telemetryLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: 1,
    marginBottom: 2,
  },
  telemetryValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#e2e8f0',
  },
  telemetryDivider: {
    width: 1,
    height: 28,
    backgroundColor: '#1e293b',
    marginHorizontal: 12,
  },
  telemetryRight: {
    alignItems: 'flex-end',
  },
  telemetryGpsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  telemetryDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  telemetryDotOk: {
    backgroundColor: '#10b981',
  },
  telemetryDotSearching: {
    backgroundColor: '#f59e0b',
  },
  telemetryDotOff: {
    backgroundColor: '#64748b',
  },
  telemetryGpsStatus: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94a3b8',
    marginRight: 6,
  },
  telemetryRefreshButton: {
    padding: 2,
  },
  telemetryRefreshText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#38bdf8',
  },
  telemetryCoords: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 10,
    color: '#64748b',
    marginTop: 1,
  },
  heroDisplay: {
    paddingTop: 18,
    paddingBottom: 16,
    paddingHorizontal: 16,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
    backgroundColor: '#0d1322',
  },
  heroCaption: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  heroValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
  },
  heroInput: {
    fontSize: 44,
    fontWeight: '800',
    color: '#f8fafc',
    minWidth: 120,
    textAlign: 'center',
    padding: 0,
    margin: 0,
    includeFontPadding: false,
  },
  heroInputError: {
    color: '#f87171',
  },
  heroUnit: {
    fontSize: 12,
    fontWeight: '700',
    color: '#38bdf8',
    letterSpacing: 1,
    marginLeft: 8,
  },
  heroHelper: {
    fontSize: 10,
    color: '#475569',
    marginTop: 4,
  },
  errorText: {
    color: '#f87171',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 4,
  },
  faseSelectorBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#0f172a',
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  faseSelectorInfo: {
    flex: 1,
  },
  faseSelectorLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: 1,
    marginBottom: 2,
  },
  faseSelectorText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#38bdf8',
  },
  faseSelectorChevron: {
    paddingLeft: 10,
  },
  faseSelectorChevronText: {
    fontSize: 14,
    color: '#64748b',
  },
  observationBlock: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#131b2e',
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  observationInput: {
    fontSize: 13,
    color: '#cbd5e1',
    minHeight: 44,
    padding: 0,
    margin: 0,
  },
  actionTrigger: {
    backgroundColor: '#0284c7',
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionTriggerDisabled: {
    opacity: 0.6,
  },
  actionTriggerText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    width: '100%',
    maxWidth: 380,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
    backgroundColor: '#0c1220',
  },
  modalTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#94a3b8',
    letterSpacing: 1,
  },
  modalCloseText: {
    fontSize: 15,
    color: '#94a3b8',
    fontWeight: '700',
  },
  modalOptionsContainer: {
    padding: 12,
    gap: 8,
  },
  modalOptionButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 6,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1e293b',
    minHeight: 52,
  },
  modalOptionButtonSelected: {
    backgroundColor: 'rgba(2, 132, 199, 0.15)',
    borderColor: '#0284c7',
  },
  modalOptionText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#cbd5e1',
  },
  modalOptionTextSelected: {
    color: '#38bdf8',
    fontWeight: '700',
  },
  modalOptionCheck: {
    fontSize: 16,
    fontWeight: '800',
    color: '#38bdf8',
  },
});
