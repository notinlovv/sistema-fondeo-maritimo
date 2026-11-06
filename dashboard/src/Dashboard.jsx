import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

// --- Cliente API con interceptor JWT integrado ---
const getBaseUrl = () => {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) {
      return import.meta.env.VITE_API_URL;
    }
  } catch {
    // Entorno sin import.meta.env
  }
  return 'http://127.0.0.1:8000';
};

const api = axios.create({
  baseURL: getBaseUrl(),
  timeout: 6000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// --- Datos de respaldo para vista previa cuando el backend local está apagado ---
const DEMO_LINEAS = [
  {
    id: 1,
    nombre: 'Línea Piloto 1 — Sector Norte',
    metros_totales: 1500,
    fecha_inicio: '2026-10-01T08:00:00Z',
    fecha_meta: '2026-10-25T18:00:00Z',
    estado: 'activa',
  },
  {
    id: 2,
    nombre: 'Línea Fondeo 2 — Bahía Sur',
    metros_totales: 2200,
    fecha_inicio: '2026-09-20T08:00:00Z',
    fecha_meta: '2026-10-16T18:00:00Z',
    estado: 'activa',
  },
];

const DEMO_REGISTROS = {
  1: [
    {
      id: 'a1b2c3d4-1111-4000-8000-000000000001',
      linea_id: 1,
      metros_avanzados: 180,
      fecha: '2026-10-12T10:15:00Z',
      latitud: -39.81422,
      longitud: -73.24589,
      estado: 'sincronizado',
      observacion: 'Instalación inicial de anclajes sin novedad.',
    },
    {
      id: 'a1b2c3d4-2222-4000-8000-000000000002',
      linea_id: 1,
      metros_avanzados: 245.5,
      fecha: '2026-10-13T14:30:00Z',
      latitud: -39.81495,
      longitud: -73.24641,
      estado: 'sincronizado',
      observacion: 'Buen clima y corriente favorable en turno mañana.',
    },
    {
      id: 'a1b2c3d4-3333-4000-8000-000000000003',
      linea_id: 1,
      metros_avanzados: 195,
      fecha: '2026-10-14T16:45:00Z',
      latitud: -39.81531,
      longitud: -73.24702,
      estado: 'sincronizado',
      observacion: 'Tramo intermedio completado.',
    },
    {
      id: 'a1b2c3d4-4444-4000-8000-000000000004',
      linea_id: 1,
      metros_avanzados: 270,
      fecha: '2026-10-15T17:10:00Z',
      latitud: -39.81602,
      longitud: -73.24788,
      estado: 'sincronizado',
      observacion: 'Avance óptimo con cuadrilla completa.',
    },
    {
      id: 'a1b2c3d4-5555-4000-8000-000000000005',
      linea_id: 1,
      metros_avanzados: 215.5,
      fecha: '2026-10-16T15:20:00Z',
      latitud: -39.81678,
      longitud: -73.24855,
      estado: 'sincronizado',
      observacion: 'Verificación de tensión con GPS en terreno.',
    },
  ],
  2: [
    {
      id: 'b2c3d4e5-1111-4000-8000-000000000001',
      linea_id: 2,
      metros_avanzados: 310,
      fecha: '2026-10-11T11:00:00Z',
      latitud: -39.82115,
      longitud: -73.2512,
      estado: 'sincronizado',
      observacion: 'Inicio de fondeo sector sur.',
    },
    {
      id: 'b2c3d4e5-2222-4000-8000-000000000002',
      linea_id: 2,
      metros_avanzados: 140,
      fecha: '2026-10-13T16:10:00Z',
      latitud: -39.82198,
      longitud: -73.25205,
      estado: 'pendiente',
      observacion: 'Marejada moderada redujo velocidad de maniobra.',
    },
    {
      id: 'b2c3d4e5-3333-4000-8000-000000000003',
      linea_id: 2,
      metros_avanzados: 185,
      fecha: '2026-10-15T18:00:00Z',
      latitud: -39.82264,
      longitud: -73.2529,
      estado: 'sincronizado',
      observacion: 'Retoma de ritmo tras ventana meteorológica.',
    },
  ],
};

const buildDemoResumen = (lineaId) => {
  const linea = DEMO_LINEAS.find((l) => l.id === Number(lineaId)) || DEMO_LINEAS[0];
  const regs = DEMO_REGISTROS[linea.id] || [];
  const acumulados = regs.reduce((acc, r) => acc + Number(r.metros_avanzados || 0), 0);
  const restantes = Math.max(0, linea.metros_totales - acumulados);
  const porcentaje = linea.metros_totales > 0 ? (acumulados / linea.metros_totales) * 100 : 0;
  const promedio7d = acumulados / 7;
  const diasEstimados = promedio7d > 0 ? restantes / promedio7d : null;
  const fechaEst =
    diasEstimados !== null
      ? new Date(Date.now() + diasEstimados * 86400000).toISOString()
      : null;
  const alerta =
    fechaEst && linea.fecha_meta
      ? new Date(fechaEst).getTime() > new Date(linea.fecha_meta).getTime()
      : false;

  return {
    linea_id: linea.id,
    linea_nombre: linea.nombre,
    metros_totales: linea.metros_totales,
    metros_acumulados: Number(acumulados.toFixed(2)),
    porcentaje_avance: Number(porcentaje.toFixed(2)),
    metros_restantes: Number(restantes.toFixed(2)),
    promedio_diario_ultimos_7_dias: Number(promedio7d.toFixed(2)),
    dias_estimados_termino: diasEstimados !== null ? Number(diasEstimados.toFixed(1)) : null,
    fecha_estimada_termino: fechaEst,
    estado: linea.estado,
    alerta_atraso: alerta,
  };
};

// --- Utilidades de formato ---
const formatNumber = (value, decimals = 2) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '0.00';
  }
  return Number(value).toLocaleString('es-CL', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

const formatDateShort = (isoString) => {
  if (!isoString) return 'No disponible';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return 'Fecha inválida';
  return date.toLocaleDateString('es-CL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const formatDateTime = (isoString) => {
  if (!isoString) return '—';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-CL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

// --- Subcomponente: Tarjeta KPI ---
function KpiCard({ title, value, subtitle, badge, accentColor = '#2563eb', children }) {
  return (
    <div style={styles.kpiCard}>
      <div style={{ ...styles.kpiAccentBar, backgroundColor: accentColor }} />
      <div style={styles.kpiHeader}>
        <span style={styles.kpiTitle}>{title}</span>
        {badge && (
          <span
            style={{
              ...styles.badge,
              backgroundColor: badge.bg || '#eff6ff',
              color: badge.color || '#1d4ed8',
            }}
          >
            {badge.text}
          </span>
        )}
      </div>
      <div style={styles.kpiValue}>{value}</div>
      {subtitle && <div style={styles.kpiSubtitle}>{subtitle}</div>}
      {children && <div style={{ marginTop: '12px' }}>{children}</div>}
    </div>
  );
}

// --- Subcomponente: Tooltip personalizado para Recharts ---
function CustomChartTooltip({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div style={styles.tooltipBox}>
      <p style={styles.tooltipTitle}>{label}</p>
      {payload.map((entry) => (
        <div key={entry.dataKey} style={styles.tooltipRow}>
          <span
            style={{
              ...styles.tooltipDot,
              backgroundColor: entry.color,
            }}
          />
          <span style={styles.tooltipLabel}>{entry.name}:</span>
          <strong style={styles.tooltipValue}>{formatNumber(entry.value)} m</strong>
        </div>
      ))}
    </div>
  );
}

function Dashboard({ onLogout }) {
  const [lineas, setLineas] = useState([]);
  const [selectedLineaId, setSelectedLineaId] = useState(null);
  const [resumen, setResumen] = useState(null);
  const [registros, setRegistros] = useState([]);

  const [loadingLineas, setLoadingLineas] = useState(true);
  const [loadingDatos, setLoadingDatos] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [chartType, setChartType] = useState('combinado'); // 'combinado' | 'area' | 'barras'

  const handleLogout = useCallback(() => {
    localStorage.removeItem('token');
    if (onLogout) onLogout();
  }, [onLogout]);

  // Manejo centralizado de errores HTTP (incluye expiración de sesión 401)
  const handleApiError = useCallback(
    (err, fallbackMessage) => {
      console.error(err);
      if (err?.response?.status === 401) {
        handleLogout();
        return;
      }
      const serverDetail = err?.response?.data?.detail;
      setError(typeof serverDetail === 'string' ? serverDetail : fallbackMessage);
    },
    [handleLogout]
  );

  // Activar datos de demostración si el backend no está encendido
  const enableDemoFallback = useCallback(() => {
    setIsDemoMode(true);
    setError(null);
    setLineas(DEMO_LINEAS);
    const initialId = DEMO_LINEAS[0].id;
    setSelectedLineaId(initialId);
    setResumen(buildDemoResumen(initialId));
    setRegistros(DEMO_REGISTROS[initialId] || []);
    setLoadingLineas(false);
    setLoadingDatos(false);
  }, []);

  // 1. Cargar lista de líneas de fondeo al montar el componente
  useEffect(() => {
    let isMounted = true;

    const fetchLineas = async () => {
      setLoadingLineas(true);
      setError(null);
      try {
        const response = await api.get('/lineas/');
        if (!isMounted) return;
        const lista = Array.isArray(response.data) ? response.data : [];
        setIsDemoMode(false);
        setLineas(lista);
        if (lista.length > 0) {
          setSelectedLineaId(lista[0].id);
        }
      } catch (err) {
        if (!isMounted) return;
        // Si no hay conexión al servidor local (ej. vista previa web), activar modo demo interactivo
        if (!err?.response) {
          enableDemoFallback();
          return;
        }
        handleApiError(
          err,
          'No se pudo cargar el listado de líneas de fondeo desde el servidor.'
        );
      } finally {
        if (isMounted) {
          setLoadingLineas(false);
        }
      }
    };

    fetchLineas();
    return () => {
      isMounted = false;
    };
  }, [handleApiError, enableDemoFallback]);

  // 2. Cargar resumen de métricas y registros cada vez que cambia la línea seleccionada
  const fetchDashboardData = useCallback(
    async (lineaId) => {
      if (!lineaId) return;

      if (isDemoMode) {
        setResumen(buildDemoResumen(lineaId));
        setRegistros(DEMO_REGISTROS[lineaId] || []);
        return;
      }

      setLoadingDatos(true);
      setError(null);
      try {
        const [resumenResp, registrosResp] = await Promise.all([
          api.get('/dashboard/resumen', { params: { linea_id: lineaId } }),
          api.get('/registros/', { params: { linea_id: lineaId } }),
        ]);
        setResumen(resumenResp.data);
        setRegistros(Array.isArray(registrosResp.data) ? registrosResp.data : []);
      } catch (err) {
        handleApiError(
          err,
          'Error al obtener las métricas y registros de la línea seleccionada.'
        );
      } finally {
        setLoadingDatos(false);
      }
    },
    [handleApiError, isDemoMode]
  );

  useEffect(() => {
    if (selectedLineaId !== null) {
      fetchDashboardData(selectedLineaId);
    }
  }, [selectedLineaId, fetchDashboardData]);

  // 3. Descargar reporte Excel (.xlsx) mediante Axios con responseType: 'blob'
  const handleDownloadExcel = async () => {
    if (!selectedLineaId) return;

    if (isDemoMode) {
      // En modo demo sin backend generamos un CSV compatible con Excel para probar la descarga
      const regs = DEMO_REGISTROS[selectedLineaId] || [];
      const header = 'UUID,Linea ID,Fecha,Metros Avanzados,Latitud,Longitud,Estado,Observacion\n';
      const rows = regs
        .map(
          (r) =>
            `${r.id},${r.linea_id},${r.fecha},${r.metros_avanzados},${r.latitud},${r.longitud},${r.estado},"${r.observacion || ''}"`
        )
        .join('\n');
      const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `reporte_avance_linea_${selectedLineaId}_demo.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      return;
    }

    setExporting(true);
    setError(null);
    try {
      const response = await api.get('/reportes/avance.xlsx', {
        params: { linea_id: selectedLineaId },
        responseType: 'blob',
      });

      const blob = new Blob([response.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.setAttribute('download', `reporte_avance_linea_${selectedLineaId}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      handleApiError(
        err,
        'No se pudo descargar el reporte Excel. Verifica tu conexión o permisos.'
      );
    } finally {
      setExporting(false);
    }
  };

  // Línea actualmente seleccionada (para acceder a fecha_meta y metadatos)
  const lineaActual = useMemo(
    () => lineas.find((l) => l.id === Number(selectedLineaId)) || null,
    [lineas, selectedLineaId]
  );

  // 4. Procesamiento de datos para el gráfico temporal (avance diario y acumulado)
  const chartData = useMemo(() => {
    if (!registros || registros.length === 0) return [];

    // Ordenar cronológicamente de más antiguo a más reciente
    const ordenados = [...registros].sort(
      (a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime()
    );

    // Agrupar por fecha (YYYY-MM-DD) para consolidar avances del mismo día
    const mapaDiario = new Map();
    ordenados.forEach((reg) => {
      const fechaObj = new Date(reg.fecha);
      const claveDia = Number.isNaN(fechaObj.getTime())
        ? 'Sin fecha'
        : fechaObj.toISOString().split('T')[0];
      const etiqueta = Number.isNaN(fechaObj.getTime())
        ? 'Sin fecha'
        : fechaObj.toLocaleDateString('es-CL', {
            day: '2-digit',
            month: 'short',
          });

      const actual = mapaDiario.get(claveDia) || {
        fechaClave: claveDia,
        fecha: etiqueta,
        metrosDia: 0,
        registrosDia: 0,
      };
      actual.metrosDia += Number(reg.metros_avanzados || 0);
      actual.registrosDia += 1;
      mapaDiario.set(claveDia, actual);
    });

    let acumulado = 0;
    return Array.from(mapaDiario.values()).map((item) => {
      acumulado += item.metrosDia;
      return {
        fecha: item.fecha,
        metrosDia: Number(item.metrosDia.toFixed(2)),
        metrosAcumulados: Number(acumulado.toFixed(2)),
      };
    });
  }, [registros]);

  // Configuración visual de estado de la línea
  const getEstadoBadge = (estado) => {
    const normalizado = (estado || '').toLowerCase();
    if (normalizado === 'completada' || normalizado === 'sincronizado') {
      return { text: estado, bg: '#dcfce7', color: '#15803d' };
    }
    if (normalizado === 'pausada' || normalizado === 'pendiente') {
      return { text: estado, bg: '#fef9c3', color: '#a16207' };
    }
    if (normalizado === 'conflicto') {
      return { text: estado, bg: '#fee2e2', color: '#b91c1c' };
    }
    return { text: estado || 'activa', bg: '#dbeafe', color: '#1d4ed8' };
  };

  const porcentajeAvance = Math.min(
    100,
    Math.max(0, Number(resumen?.porcentaje_avance || 0))
  );

  return (
    <div style={styles.pageWrapper}>
      {/* Cabecera Superior */}
      <header style={styles.header}>
        <div style={styles.headerBrand}>
          <div style={styles.logoBadge}>LF</div>
          <div>
            <h1 style={styles.headerTitle}>Panel de Control — Líneas de Fondeo</h1>
            <p style={styles.headerSubtitle}>
              Monitoreo de avance en terreno, proyecciones y trazabilidad operativa
            </p>
          </div>
        </div>

        <div style={styles.headerControls}>
          {/* Selector de Línea de Fondeo */}
          <div style={styles.selectorGroup}>
            <label htmlFor="selector-linea" style={styles.selectorLabel}>
              Línea activa:
            </label>
            <select
              id="selector-linea"
              value={selectedLineaId ?? ''}
              onChange={(e) => setSelectedLineaId(Number(e.target.value))}
              disabled={loadingLineas || lineas.length === 0}
              style={styles.selectInput}
            >
              {lineas.length === 0 ? (
                <option value="">Sin líneas registradas</option>
              ) : (
                lineas.map((linea) => (
                  <option key={linea.id} value={linea.id}>
                    {linea.nombre} ({formatNumber(linea.metros_totales, 0)} m)
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Botón Actualizar */}
          <button
            type="button"
            onClick={() => fetchDashboardData(selectedLineaId)}
            disabled={loadingDatos || !selectedLineaId}
            style={styles.secondaryButton}
            title="Refrescar métricas y registros"
          >
            {loadingDatos ? 'Actualizando...' : 'Actualizar'}
          </button>

          {/* Botón Descargar Excel */}
          <button
            type="button"
            onClick={handleDownloadExcel}
            disabled={exporting || !selectedLineaId}
            style={styles.excelButton}
          >
            {exporting ? 'Generando Excel...' : 'Descargar Excel (.xlsx)'}
          </button>

          {/* Botón Cerrar Sesión */}
          <button type="button" onClick={handleLogout} style={styles.logoutButton}>
            Cerrar Sesión
          </button>
        </div>
      </header>

      <main style={styles.mainContent}>
        {/* Aviso si está en modo demostración por backend desconectado */}
        {isDemoMode && (
          <div style={styles.demoBanner}>
            <div>
              <strong>Modo Vista Previa Activo: </strong>
              <span>
                No se detectó conexión con FastAPI en <code>{getBaseUrl()}</code>. Mostrando
                datos simulados para previsualización interactiva.
              </span>
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={styles.demoRetryBtn}
            >
              Reconectar API
            </button>
          </div>
        )}

        {/* Banner de Error General */}
        {error && (
          <div style={styles.errorBanner} role="alert">
            <div>
              <strong>Error de comunicación: </strong>
              <span>{error}</span>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {selectedLineaId && (
                <button
                  type="button"
                  onClick={() => fetchDashboardData(selectedLineaId)}
                  style={styles.retryButton}
                >
                  Reintentar
                </button>
              )}
              <button
                type="button"
                onClick={enableDemoFallback}
                style={styles.retryButton}
              >
                Ver Demo
              </button>
            </div>
          </div>
        )}

        {/* Estado de Carga Inicial */}
        {(loadingLineas || (loadingDatos && !resumen)) && (
          <div style={styles.loadingCard}>
            <div style={styles.spinner} />
            <p style={{ margin: 0, color: '#475569', fontWeight: 500 }}>
              Sincronizando métricas e historial de avance...
            </p>
          </div>
        )}

        {/* Contenido Principal cuando existe una línea seleccionada */}
        {!loadingLineas && resumen && (
          <>
            {/* Banner de Alerta de Atraso */}
            {resumen.alerta_atraso && (
              <div style={styles.delayAlertBanner} role="alert">
                <div style={styles.delayAlertIcon}>!</div>
                <div style={{ flex: 1 }}>
                  <h2 style={styles.delayAlertTitle}>
                    Alerta de Desviación en el Cronograma — {resumen.linea_nombre}
                  </h2>
                  <p style={styles.delayAlertText}>
                    {resumen.fecha_estimada_termino
                      ? `Al ritmo actual de los últimos 7 días (${formatNumber(
                          resumen.promedio_diario_ultimos_7_dias
                        )} m/día), la fecha estimada de término (${formatDateShort(
                          resumen.fecha_estimada_termino
                        )}) supera la fecha meta planificada${
                          lineaActual?.fecha_meta
                            ? ` (${formatDateShort(lineaActual.fecha_meta)})`
                            : ''
                        }.`
                      : 'No se registran avances en los últimos 7 días y existen metros pendientes para cumplir la fecha meta planificada.'}
                  </p>
                </div>
              </div>
            )}

            {/* Grilla de 4 Tarjetas KPI */}
            <section style={styles.kpiGrid}>
              {/* Tarjeta 1: % de Avance General */}
              <KpiCard
                title="Avance General"
                value={`${formatNumber(resumen.porcentaje_avance)}%`}
                subtitle={`Línea: ${resumen.linea_nombre}`}
                badge={getEstadoBadge(resumen.estado)}
                accentColor="#2563eb"
              >
                <div style={styles.progressBarTrack}>
                  <div
                    style={{
                      ...styles.progressBarFill,
                      width: `${porcentajeAvance}%`,
                      backgroundColor:
                        porcentajeAvance >= 100
                          ? '#16a34a'
                          : resumen.alerta_atraso
                          ? '#dc2626'
                          : '#2563eb',
                    }}
                  />
                </div>
                <div style={styles.progressLabels}>
                  <span>0%</span>
                  <span>Meta: 100%</span>
                </div>
              </KpiCard>

              {/* Tarjeta 2: Metros Acumulados vs Totales */}
              <KpiCard
                title="Progreso Lineal (Metros)"
                value={`${formatNumber(resumen.metros_acumulados)} m`}
                subtitle={`de ${formatNumber(resumen.metros_totales)} m totales`}
                badge={{
                  text: `Restan ${formatNumber(resumen.metros_restantes)} m`,
                  bg: '#f1f5f9',
                  color: '#334155',
                }}
                accentColor="#0ea5e9"
              />

              {/* Tarjeta 3: Ritmo de Trabajo (Promedio 7 días) */}
              <KpiCard
                title="Ritmo de Trabajo (Últimos 7 días)"
                value={`${formatNumber(resumen.promedio_diario_ultimos_7_dias)} m/día`}
                subtitle="Velocidad media de instalación reciente"
                badge={{
                  text:
                    resumen.promedio_diario_ultimos_7_dias > 0
                      ? 'En movimiento'
                      : 'Sin avance 7d',
                  bg:
                    resumen.promedio_diario_ultimos_7_dias > 0
                      ? '#ecfdf5'
                      : '#fef2f2',
                  color:
                    resumen.promedio_diario_ultimos_7_dias > 0
                      ? '#047857'
                      : '#b91c1c',
                }}
                accentColor="#8b5cf6"
              />

              {/* Tarjeta 4: Proyección de Término */}
              <KpiCard
                title="Proyección de Término"
                value={
                  resumen.metros_restantes <= 0
                    ? 'Completada'
                    : resumen.dias_estimados_termino !== null
                    ? `${formatNumber(resumen.dias_estimados_termino, 1)} días`
                    : 'Indeterminado'
                }
                subtitle={
                  resumen.fecha_estimada_termino
                    ? `Término estimado: ${formatDateShort(resumen.fecha_estimada_termino)}`
                    : 'Se requiere avance en los últimos 7 días para proyectar'
                }
                badge={
                  resumen.alerta_atraso
                    ? { text: 'En atraso', bg: '#fee2e2', color: '#b91c1c' }
                    : { text: 'En plazo', bg: '#dcfce7', color: '#15803d' }
                }
                accentColor={resumen.alerta_atraso ? '#dc2626' : '#10b981'}
              >
                {lineaActual?.fecha_meta && (
                  <div style={styles.metaDateNote}>
                    Fecha meta contractual: {formatDateShort(lineaActual.fecha_meta)}
                  </div>
                )}
              </KpiCard>
            </section>

            {/* Sección de Gráfico de Evolución con Recharts */}
            <section style={styles.cardSection}>
              <div style={styles.sectionHeader}>
                <div>
                  <h2 style={styles.sectionTitle}>
                    Evolución del Avance Diario y Acumulado
                  </h2>
                  <p style={styles.sectionDescription}>
                    Curva de crecimiento acumulado (m) versus producción diaria registrada en
                    terreno
                  </p>
                </div>

                {/* Selector de tipo de visualización */}
                <div style={styles.chartToggleGroup}>
                  {[
                    { id: 'combinado', label: 'Combinado' },
                    { id: 'area', label: 'Área Acumulada' },
                    { id: 'barras', label: 'Barras Diarias' },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setChartType(tab.id)}
                      style={
                        chartType === tab.id
                          ? styles.chartToggleActive
                          : styles.chartToggleBtn
                      }
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {chartData.length === 0 ? (
                <div style={styles.emptyState}>
                  No existen registros de avance para graficar en esta línea de fondeo.
                </div>
              ) : (
                <div style={{ width: '100%', height: 340 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    {chartType === 'combinado' ? (
                      <ComposedChart
                        data={chartData}
                        margin={{ top: 15, right: 25, left: 10, bottom: 5 }}
                      >
                        <defs>
                          <linearGradient
                            id="colorAcumulado"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop offset="5%" stopColor="#2563eb" stopOpacity={0.28} />
                            <stop offset="95%" stopColor="#2563eb" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis
                          dataKey="fecha"
                          stroke="#64748b"
                          fontSize={12}
                          tickMargin={8}
                        />
                        <YAxis
                          stroke="#64748b"
                          fontSize={12}
                          tickFormatter={(val) => `${val} m`}
                        />
                        <Tooltip content={<CustomChartTooltip />} />
                        <Legend wrapperStyle={{ paddingTop: '10px' }} />
                        <Area
                          type="monotone"
                          dataKey="metrosAcumulados"
                          name="Avance Acumulado (m)"
                          stroke="#2563eb"
                          strokeWidth={2.5}
                          fill="url(#colorAcumulado)"
                        />
                        <Bar
                          dataKey="metrosDia"
                          name="Avance Diario (m)"
                          fill="#0ea5e9"
                          radius={[6, 6, 0, 0]}
                          maxBarSize={44}
                        />
                      </ComposedChart>
                    ) : chartType === 'area' ? (
                      <AreaChart
                        data={chartData}
                        margin={{ top: 15, right: 25, left: 10, bottom: 5 }}
                      >
                        <defs>
                          <linearGradient
                            id="colorAreaOnly"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop offset="5%" stopColor="#2563eb" stopOpacity={0.35} />
                            <stop offset="95%" stopColor="#2563eb" stopOpacity={0.03} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="fecha" stroke="#64748b" fontSize={12} />
                        <YAxis
                          stroke="#64748b"
                          fontSize={12}
                          tickFormatter={(val) => `${val} m`}
                        />
                        <Tooltip content={<CustomChartTooltip />} />
                        <Legend wrapperStyle={{ paddingTop: '10px' }} />
                        <Area
                          type="monotone"
                          dataKey="metrosAcumulados"
                          name="Avance Acumulado (m)"
                          stroke="#2563eb"
                          strokeWidth={3}
                          fill="url(#colorAreaOnly)"
                        />
                      </AreaChart>
                    ) : (
                      <BarChart
                        data={chartData}
                        margin={{ top: 15, right: 25, left: 10, bottom: 5 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="fecha" stroke="#64748b" fontSize={12} />
                        <YAxis
                          stroke="#64748b"
                          fontSize={12}
                          tickFormatter={(val) => `${val} m`}
                        />
                        <Tooltip content={<CustomChartTooltip />} />
                        <Legend wrapperStyle={{ paddingTop: '10px' }} />
                        <Bar
                          dataKey="metrosDia"
                          name="Avance Diario (m)"
                          fill="#0ea5e9"
                          radius={[6, 6, 0, 0]}
                          maxBarSize={52}
                        />
                      </BarChart>
                    )}
                  </ResponsiveContainer>
                </div>
              )}
            </section>

            {/* Tabla Detallada de Registros de Avance */}
            <section style={styles.cardSection}>
              <div style={styles.sectionHeader}>
                <div>
                  <h2 style={styles.sectionTitle}>
                    Historial Detallado de Registros en Terreno
                  </h2>
                  <p style={styles.sectionDescription}>
                    Últimos reportes sincronizados con coordenadas GPS y estado de validación
                  </p>
                </div>
                <span style={styles.recordCountBadge}>
                  {registros.length} {registros.length === 1 ? 'registro' : 'registros'}
                </span>
              </div>

              {registros.length === 0 ? (
                <div style={styles.emptyState}>
                  No se han ingresado registros de avance para esta línea todavía.
                </div>
              ) : (
                <div style={styles.tableResponsive}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>Fecha Registro</th>
                        <th style={{ ...styles.th, textAlign: 'right' }}>
                          Metros Avanzados
                        </th>
                        <th style={styles.th}>Coordenadas (Lat / Lon)</th>
                        <th style={{ ...styles.th, textAlign: 'center' }}>Estado</th>
                        <th style={styles.th}>Observaciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {registros.map((reg) => {
                        const badge = getEstadoBadge(reg.estado);
                        const tieneCoordenadas =
                          reg.latitud !== null &&
                          reg.latitud !== undefined &&
                          reg.longitud !== null &&
                          reg.longitud !== undefined;

                        return (
                          <tr key={reg.id} style={styles.tr}>
                            <td style={styles.td}>
                              <div style={{ fontWeight: 600, color: '#0f172a' }}>
                                {formatDateTime(reg.fecha)}
                              </div>
                              <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                                UUID: {String(reg.id).slice(0, 8)}...
                              </div>
                            </td>

                            <td
                              style={{
                                ...styles.td,
                                textAlign: 'right',
                                fontWeight: 700,
                                color: '#1e3a8a',
                              }}
                            >
                              +{formatNumber(reg.metros_avanzados)} m
                            </td>

                            <td style={styles.td}>
                              {tieneCoordenadas ? (
                                <span style={styles.coordsCode}>
                                  {Number(reg.latitud).toFixed(5)},{' '}
                                  {Number(reg.longitud).toFixed(5)}
                                </span>
                              ) : (
                                <span style={{ color: '#94a3b8', fontSize: '13px' }}>
                                  Sin coordenadas GPS
                                </span>
                              )}
                            </td>

                            <td style={{ ...styles.td, textAlign: 'center' }}>
                              <span
                                style={{
                                  ...styles.badge,
                                  backgroundColor: badge.bg,
                                  color: badge.color,
                                }}
                              >
                                {badge.text}
                              </span>
                            </td>

                            <td style={styles.td}>
                              {reg.observacion ? (
                                <span style={{ color: '#334155' }}>{reg.observacion}</span>
                              ) : (
                                <span style={{ color: '#94a3b8' }}>Sin observaciones</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

// --- Estilos modernos tipo SaaS ---
const styles = {
  pageWrapper: {
    minHeight: '100vh',
    backgroundColor: '#f8fafc',
    color: '#0f172a',
    fontFamily:
      "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    paddingBottom: '48px',
  },
  header: {
    backgroundColor: '#ffffff',
    borderBottom: '1px solid #e2e8f0',
    padding: '16px 28px',
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '16px',
    position: 'sticky',
    top: 0,
    zIndex: 20,
    boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
  },
  headerBrand: {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
  },
  logoBadge: {
    width: '42px',
    height: '42px',
    borderRadius: '10px',
    background: 'linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%)',
    color: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 800,
    fontSize: '16px',
    letterSpacing: '0.5px',
  },
  headerTitle: {
    margin: 0,
    fontSize: '20px',
    fontWeight: 700,
    color: '#0f172a',
  },
  headerSubtitle: {
    margin: '2px 0 0 0',
    fontSize: '13px',
    color: '#64748b',
  },
  headerControls: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '10px',
  },
  selectorGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    backgroundColor: '#f1f5f9',
    padding: '6px 12px',
    borderRadius: '8px',
    border: '1px solid #cbd5e1',
  },
  selectorLabel: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#334155',
  },
  selectInput: {
    border: 'none',
    backgroundColor: 'transparent',
    fontSize: '14px',
    fontWeight: 600,
    color: '#0f172a',
    outline: 'none',
    cursor: 'pointer',
  },
  secondaryButton: {
    padding: '9px 14px',
    borderRadius: '8px',
    border: '1px solid #cbd5e1',
    backgroundColor: '#ffffff',
    color: '#334155',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  excelButton: {
    padding: '9px 16px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#059669',
    color: '#ffffff',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    boxShadow: '0 1px 2px rgba(5, 150, 105, 0.2)',
  },
  logoutButton: {
    padding: '9px 14px',
    borderRadius: '8px',
    border: '1px solid #fecaca',
    backgroundColor: '#fef2f2',
    color: '#dc2626',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  mainContent: {
    maxWidth: '1280px',
    margin: '24px auto 0',
    padding: '0 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
  },
  demoBanner: {
    backgroundColor: '#eff6ff',
    border: '1px solid #bfdbfe',
    color: '#1e40af',
    padding: '12px 18px',
    borderRadius: '10px',
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    fontSize: '13.5px',
  },
  demoRetryBtn: {
    padding: '6px 12px',
    borderRadius: '6px',
    border: '1px solid #93c5fd',
    backgroundColor: '#ffffff',
    color: '#1d4ed8',
    fontWeight: 600,
    fontSize: '12.5px',
    cursor: 'pointer',
  },
  errorBanner: {
    backgroundColor: '#fef2f2',
    border: '1px solid #fecaca',
    color: '#991b1b',
    padding: '14px 18px',
    borderRadius: '10px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    fontSize: '14px',
  },
  retryButton: {
    padding: '6px 12px',
    borderRadius: '6px',
    border: '1px solid #f87171',
    backgroundColor: '#ffffff',
    color: '#b91c1c',
    fontWeight: 600,
    cursor: 'pointer',
  },
  loadingCard: {
    backgroundColor: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '12px',
    padding: '48px 24px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
  },
  spinner: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    border: '3px solid #e2e8f0',
    borderTopColor: '#2563eb',
  },
  delayAlertBanner: {
    backgroundColor: '#fff1f2',
    border: '1px solid #fda4af',
    borderLeft: '6px solid #e11d48',
    borderRadius: '12px',
    padding: '16px 20px',
    display: 'flex',
    alignItems: 'flex-start',
    gap: '16px',
    boxShadow: '0 2px 6px rgba(225, 29, 72, 0.08)',
  },
  delayAlertIcon: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    backgroundColor: '#e11d48',
    color: '#ffffff',
    fontWeight: 800,
    fontSize: '18px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  delayAlertTitle: {
    margin: '0 0 4px 0',
    fontSize: '15px',
    fontWeight: 700,
    color: '#881337',
  },
  delayAlertText: {
    margin: 0,
    fontSize: '13.5px',
    color: '#9f1239',
    lineHeight: 1.5,
  },
  kpiGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: '18px',
  },
  kpiCard: {
    backgroundColor: '#ffffff',
    borderRadius: '12px',
    border: '1px solid #e2e8f0',
    padding: '20px',
    position: 'relative',
    overflow: 'hidden',
    boxShadow: '0 1px 3px rgba(15, 23, 42, 0.03)',
  },
  kpiAccentBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '4px',
  },
  kpiHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '10px',
  },
  kpiTitle: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.4px',
  },
  kpiValue: {
    fontSize: '28px',
    fontWeight: 800,
    color: '#0f172a',
    marginBottom: '4px',
  },
  kpiSubtitle: {
    fontSize: '13px',
    color: '#64748b',
  },
  badge: {
    display: 'inline-block',
    padding: '3px 10px',
    borderRadius: '999px',
    fontSize: '12px',
    fontWeight: 600,
    textTransform: 'capitalize',
  },
  progressBarTrack: {
    width: '100%',
    height: '10px',
    backgroundColor: '#e2e8f0',
    borderRadius: '999px',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: '999px',
    transition: 'width 0.4s ease',
  },
  progressLabels: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '11px',
    color: '#94a3b8',
    marginTop: '6px',
    fontWeight: 500,
  },
  metaDateNote: {
    fontSize: '12px',
    color: '#475569',
    backgroundColor: '#f8fafc',
    padding: '6px 10px',
    borderRadius: '6px',
    border: '1px solid #e2e8f0',
  },
  cardSection: {
    backgroundColor: '#ffffff',
    borderRadius: '12px',
    border: '1px solid #e2e8f0',
    padding: '22px 24px',
    boxShadow: '0 1px 3px rgba(15, 23, 42, 0.03)',
  },
  sectionHeader: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '20px',
  },
  sectionTitle: {
    margin: 0,
    fontSize: '17px',
    fontWeight: 700,
    color: '#0f172a',
  },
  sectionDescription: {
    margin: '4px 0 0 0',
    fontSize: '13px',
    color: '#64748b',
  },
  chartToggleGroup: {
    display: 'flex',
    backgroundColor: '#f1f5f9',
    padding: '4px',
    borderRadius: '8px',
    gap: '4px',
  },
  chartToggleBtn: {
    border: 'none',
    backgroundColor: 'transparent',
    color: '#64748b',
    fontSize: '12px',
    fontWeight: 600,
    padding: '6px 12px',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  chartToggleActive: {
    border: 'none',
    backgroundColor: '#ffffff',
    color: '#1e3a8a',
    fontSize: '12px',
    fontWeight: 700,
    padding: '6px 12px',
    borderRadius: '6px',
    cursor: 'pointer',
    boxShadow: '0 1px 2px rgba(15, 23, 42, 0.08)',
  },
  tooltipBox: {
    backgroundColor: '#ffffff',
    border: '1px solid #cbd5e1',
    borderRadius: '8px',
    padding: '10px 14px',
    boxShadow: '0 4px 12px rgba(15, 23, 42, 0.1)',
  },
  tooltipTitle: {
    margin: '0 0 6px 0',
    fontSize: '12px',
    fontWeight: 700,
    color: '#334155',
    borderBottom: '1px solid #f1f5f9',
    paddingBottom: '4px',
  },
  tooltipRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '13px',
    marginTop: '4px',
  },
  tooltipDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
  },
  tooltipLabel: {
    color: '#64748b',
  },
  tooltipValue: {
    color: '#0f172a',
  },
  recordCountBadge: {
    backgroundColor: '#f1f5f9',
    color: '#475569',
    padding: '4px 12px',
    borderRadius: '999px',
    fontSize: '12px',
    fontWeight: 600,
  },
  emptyState: {
    padding: '36px 20px',
    textAlign: 'center',
    color: '#64748b',
    backgroundColor: '#f8fafc',
    borderRadius: '8px',
    border: '1px dashed #cbd5e1',
    fontSize: '14px',
  },
  tableResponsive: {
    width: '100%',
    overflowX: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '14px',
  },
  th: {
    textAlign: 'left',
    padding: '12px 14px',
    backgroundColor: '#f8fafc',
    borderBottom: '2px solid #e2e8f0',
    color: '#475569',
    fontSize: '12px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.4px',
  },
  tr: {
    borderBottom: '1px solid #f1f5f9',
  },
  td: {
    padding: '13px 14px',
    verticalAlign: 'middle',
  },
  coordsCode: {
    fontFamily: 'monospace',
    fontSize: '12.5px',
    backgroundColor: '#f1f5f9',
    color: '#334155',
    padding: '3px 8px',
    borderRadius: '4px',
  },
};

export default Dashboard;