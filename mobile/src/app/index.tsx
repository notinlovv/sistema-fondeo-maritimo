import { useEffect, useState } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useForm, Controller } from 'react-hook-form';
import * as Location from 'expo-location';
import uuid from 'react-native-uuid';
import { guardarRegistroYEncolar, contarRegistrosPendientes } from '../db/outbox';
import { registroSchema } from '../schemas/registro';
import { sincronizarLote } from '../sync/syncManager';

interface FormInputValues {
  linea_id: number;
  metros_avanzados: string;
  observacion: string;
}

type GpsState = 'iniciando' | 'buscando' | 'fijado' | 'denegado' | 'error';

export default function CapturaTerrenoScreen() {
  const [gpsStatus, setGpsStatus] = useState<GpsState>('iniciando');
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ latitude: number | null; longitude: number | null }>({
    latitude: null,
    longitude: null,
  });
  const [isRefreshingGps, setIsRefreshingGps] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [pendientesCount, setPendientesCount] = useState<number>(0);

  const {
    control,
    handleSubmit,
    setValue,
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

  // Actualizar contador de registros pendientes en el Outbox local
  const refrescarContadorPendientes = async () => {
    try {
      const count = await contarRegistrosPendientes();
      setPendientesCount(count);
    } catch (err) {
      console.warn('Error al leer registros pendientes:', err);
    }
  };

  // Captura desatendida de coordenadas mediante el hardware GPS
  const capturarCoordenadasGPS = async () => {
    setIsRefreshingGps(true);
    setGpsStatus('buscando');
    setGpsError(null);

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setGpsStatus('denegado');
        setGpsError('Permiso de GPS denegado');
        setCoords({ latitude: null, longitude: null });
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const { latitude, longitude } = location.coords;
      setCoords({ latitude, longitude });
      setGpsStatus('fijado');
    } catch (error) {
      console.error('Error al capturar GPS:', error);
      setGpsStatus('error');
      setGpsError('Señal satelital no disponible');
      setCoords({ latitude: null, longitude: null });
    } finally {
      setIsRefreshingGps(false);
    }
  };

  useEffect(() => {
    capturarCoordenadasGPS();
    refrescarContadorPendientes();
  }, []);

  // Generación de UUID v4 con compatibilidad universal
  const generarUUID = (): string => {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
    return uuid.v4() as string;
  };

  const onSubmit = async (data: FormInputValues) => {
    // 1. Criterio de aceptación: No permitir guardado sin coordenadas GPS válidas
    if (coords.latitude === null || coords.longitude === null) {
      Alert.alert(
        'GPS no disponible',
        'No es posible registrar el avance sin una posición GPS fijada por hardware. Por favor presiona "Refrescar GPS".'
      );
      return;
    }

    // Normalizar entrada de metros (admite coma y punto decimal)
    const metrosLimpios = data.metros_avanzados.trim().replace(',', '.');
    const metrosNumero = parseFloat(metrosLimpios);

    // 2. Validación con esquema Zod
    const validacion = registroSchema.safeParse({
      linea_id: data.linea_id,
      metros_avanzados: isNaN(metrosNumero) ? undefined : metrosNumero,
      latitud: coords.latitude,
      longitud: coords.longitude,
      observacion: data.observacion?.trim() || null,
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

      // 3. Persistencia atómica en SQLite y encolado en Transactional Outbox
      await guardarRegistroYEncolar({
        id: nuevoUUID,
        linea_id: validacion.data.linea_id,
        usuario_id: 1, // Supervisor de terreno autenticado
        metros_avanzados: validacion.data.metros_avanzados,
        fecha: fechaISO,
        latitud: validacion.data.latitud,
        longitud: validacion.data.longitud,
        estado: 'activa',
        observacion: validacion.data.observacion ?? null,
      });

      // 4. Notificación visual y limpieza del formulario para la siguiente maniobra
      Alert.alert('Éxito', 'Registro guardado localmente en modo sin conexión');

      reset({
        linea_id: 1,
        metros_avanzados: '',
        observacion: '',
      });

      // Disparar sincronización oportunista si hay red en este instante
      sincronizarLote()
        .then(() => refrescarContadorPendientes())
        .catch(() => {});

      await refrescarContadorPendientes();
    } catch (error) {
      console.error('Error al guardar registro local:', error);
      Alert.alert(
        'Error',
        'No se pudo persistir el registro en la base de datos local. Intenta nuevamente.'
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
        >
          {/* Encabezado Terreno */}
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <Text style={styles.appTitle}>Sistema de Fondeo</Text>
              <View style={styles.offlineBadge}>
                <Text style={styles.offlineBadgeText}>Modo Offline</Text>
              </View>
            </View>
            <Text style={styles.screenSubtitle}>Captura de Avance Diario</Text>

            {/* Badge de Registros en Cola Outbox */}
            <View style={styles.counterRow}>
              <Text style={styles.counterText}>
                Cola Outbox Local: <Text style={styles.counterBold}>{pendientesCount} pendientes</Text>
              </Text>
            </View>
          </View>

          {/* Tarjeta de Certificación GPS de Hardware */}
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardTitle}>Geolocalización por Hardware</Text>
              <View
                style={[
                  styles.statusPill,
                  gpsStatus === 'fijado' && styles.statusPillSuccess,
                  (gpsStatus === 'buscando' || gpsStatus === 'iniciando') && styles.statusPillWarning,
                  (gpsStatus === 'error' || gpsStatus === 'denegado') && styles.statusPillDanger,
                ]}
              >
                <Text
                  style={[
                    styles.statusPillText,
                    gpsStatus === 'fijado' && styles.statusTextSuccess,
                    (gpsStatus === 'buscando' || gpsStatus === 'iniciando') && styles.statusTextWarning,
                    (gpsStatus === 'error' || gpsStatus === 'denegado') && styles.statusTextDanger,
                  ]}
                >
                  {gpsStatus === 'fijado' && 'GPS Fijado'}
                  {(gpsStatus === 'buscando' || gpsStatus === 'iniciando') && 'Buscando señal...'}
                  {gpsStatus === 'denegado' && 'Permiso Denegado'}
                  {gpsStatus === 'error' && 'Sin Señal GPS'}
                </Text>
              </View>
            </View>

            {gpsError ? (
              <Text style={styles.gpsErrorText}>{gpsError}</Text>
            ) : null}

            {/* Coordenadas estrictamente de solo lectura */}
            <View style={styles.gpsGrid}>
              <View style={styles.gpsGridItem}>
                <Text style={styles.readOnlyLabel}>Latitud (Solo lectura):</Text>
                <TextInput
                  style={[styles.input, styles.inputReadOnly]}
                  value={coords.latitude !== null ? coords.latitude.toFixed(6) : '---'}
                  editable={false}
                  selectTextOnFocus={false}
                />
              </View>

              <View style={styles.gpsGridItem}>
                <Text style={styles.readOnlyLabel}>Longitud (Solo lectura):</Text>
                <TextInput
                  style={[styles.input, styles.inputReadOnly]}
                  value={coords.longitude !== null ? coords.longitude.toFixed(6) : '---'}
                  editable={false}
                  selectTextOnFocus={false}
                />
              </View>
            </View>

            {/* Botón táctil para refrescar GPS */}
            <TouchableOpacity
              style={styles.refreshGpsButton}
              onPress={capturarCoordenadasGPS}
              disabled={isRefreshingGps}
              activeOpacity={0.8}
            >
              {isRefreshingGps ? (
                <ActivityIndicator color="#ffffff" size="small" />
              ) : (
                <Text style={styles.refreshGpsButtonText}>Refrescar Posición GPS</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Formulario de Captura */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Datos de la Maniobra</Text>

            {/* Línea de Fondeo (fijada por defecto a Línea Piloto ID: 1) */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Línea de Fondeo:</Text>
              <View style={styles.lockedLineBadge}>
                <Text style={styles.lockedLineText}>Línea Piloto (ID: 1) - Fondeo Activo</Text>
              </View>
            </View>

            {/* Metros Avanzados */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>
                Metros Avanzados <Text style={styles.requiredAsterisk}>*</Text>:
              </Text>
              <Controller
                control={control}
                name="metros_avanzados"
                render={({ field: { onChange, onBlur, value } }) => (
                  <TextInput
                    style={[
                      styles.input,
                      styles.inputMetros,
                      errors.metros_avanzados && styles.inputError,
                    ]}
                    placeholder="Ej: 75.5"
                    placeholderTextColor="#94a3b8"
                    keyboardType="decimal-pad"
                    onBlur={onBlur}
                    onChangeText={(val) => {
                      onChange(val);
                      if (errors.metros_avanzados) {
                        clearErrors('metros_avanzados');
                      }
                    }}
                    value={value}
                  />
                )}
              />
              {errors.metros_avanzados ? (
                <Text style={styles.errorMessage}>{errors.metros_avanzados.message}</Text>
              ) : null}
            </View>

            {/* Observaciones */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Observación (Opcional):</Text>
              <Controller
                control={control}
                name="observacion"
                render={({ field: { onChange, onBlur, value } }) => (
                  <TextInput
                    style={[styles.input, styles.inputMultiline]}
                    placeholder="Condiciones de marea, estado del lecho marino u observaciones..."
                    placeholderTextColor="#94a3b8"
                    multiline
                    numberOfLines={3}
                    textAlignVertical="top"
                    onBlur={onBlur}
                    onChangeText={onChange}
                    value={value}
                    maxLength={500}
                  />
                )}
              />
            </View>

            {/* Botón Principal de Acción para Terreno (optimizado para guantes) */}
            <TouchableOpacity
              style={[
                styles.submitButton,
                (isSaving || coords.latitude === null) && styles.submitButtonDisabled,
              ]}
              onPress={handleSubmit(onSubmit)}
              disabled={isSaving}
              activeOpacity={0.8}
            >
              {isSaving ? (
                <ActivityIndicator color="#ffffff" size="large" />
              ) : (
                <Text style={styles.submitButtonText}>Guardar Registro en Terreno</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  keyboardContainer: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 36,
  },
  header: {
    marginBottom: 16,
  },
  headerTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  appTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#ffffff',
  },
  offlineBadge: {
    backgroundColor: '#0369a1',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  offlineBadgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  screenSubtitle: {
    fontSize: 15,
    color: '#94a3b8',
    marginBottom: 8,
  },
  counterRow: {
    backgroundColor: '#1e293b',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  counterText: {
    color: '#cbd5e1',
    fontSize: 13,
  },
  counterBold: {
    fontWeight: '700',
    color: '#38bdf8',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 18,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    flex: 1,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
  },
  statusPillSuccess: {
    backgroundColor: '#dcfce7',
  },
  statusPillWarning: {
    backgroundColor: '#fef3c7',
  },
  statusPillDanger: {
    backgroundColor: '#fee2e2',
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  statusTextSuccess: {
    color: '#15803d',
  },
  statusTextWarning: {
    color: '#b45309',
  },
  statusTextDanger: {
    color: '#b91c1c',
  },
  gpsErrorText: {
    color: '#dc2626',
    fontSize: 13,
    marginBottom: 8,
    fontWeight: '600',
  },
  gpsGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 14,
  },
  gpsGridItem: {
    flex: 1,
  },
  readOnlyLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    marginBottom: 4,
  },
  input: {
    backgroundColor: '#f8fafc',
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#0f172a',
  },
  inputReadOnly: {
    backgroundColor: '#f1f5f9',
    borderColor: '#e2e8f0',
    color: '#475569',
    fontWeight: '700',
  },
  inputMetros: {
    fontSize: 22,
    fontWeight: '700',
    paddingVertical: 14,
  },
  inputMultiline: {
    height: 80,
    fontSize: 15,
  },
  inputError: {
    borderColor: '#ef4444',
    backgroundColor: '#fff5f5',
  },
  errorMessage: {
    color: '#dc2626',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
  refreshGpsButton: {
    backgroundColor: '#2563eb',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  refreshGpsButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  fieldGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6,
  },
  requiredAsterisk: {
    color: '#ef4444',
  },
  lockedLineBadge: {
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    padding: 12,
  },
  lockedLineText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#334155',
  },
  submitButton: {
    backgroundColor: '#16a34a',
    borderRadius: 10,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    minHeight: 58,
    shadowColor: '#16a34a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  submitButtonDisabled: {
    backgroundColor: '#94a3b8',
    shadowOpacity: 0,
    elevation: 0,
  },
  submitButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
