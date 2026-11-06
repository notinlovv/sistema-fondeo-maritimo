import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  descargarReporteExcel,
  obtenerLineas,
  obtenerResumenDashboard,
} from './api';

// --- Iconos SVG Inline reutilizables (sin dependencias adicionales) ---
const AlertTriangleIcon = ({ size = 22, color = '#dc2626' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ flexShrink: 0 }}
  >
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const CheckCircleIcon = ({ size = 20, color = '#16a34a' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ flexShrink: 0 }}
  >
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

const RefreshIcon = ({ size = 16, spinning = false }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{
      animation: spinning ? 'spin 1s linear infinite' : 'none',
      transformOrigin: 'center',
    }}
  >
    <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
    <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
    <path d="M16 21h5v-5" />
  </svg>
);

const DownloadIcon = ({ size = 16 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const LogOutIcon = ({ size = 16 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

// --- Datos simulados para previsualización inmediata si el backend está apagado ---
const DEMO_LINEAS = [
  {
    id: 1,
    nombre: 'Línea Piloto 1 — Sector Norte',
    metros_totales: 2000,
    fecha_inicio: '2026-10-01T08:00:00Z',
    fecha_meta: '2026-11-20T18:00:00Z',
    estado: 'activa',
  },
  {
    id: 2,
    nombre: 'Línea Fondeo 2 — Bahía Sur (En Desfase)',
    metros_totales: 2500,
    fecha_inicio: '2026-09-15T08:00:00Z',
    fecha_meta: '2026-11-01T18:00:00Z',
    estado: 'activa',
  },
];

const DEMO_RESUMENES = {
  1: {
    linea_id: 1,
    nombre_linea: 'Línea Piloto 1 — Sector Norte',
    estado_linea: 'activa',
    metros_totales: 2000,
    metros_acumulados: 1370.5,
    metros_restantes: 629.5,
    porcentaje_avance: 68.53,
    promedio_diario_7d: 112.4,
    dias_estimados_termino: 6,
    fecha_estimada_termino: '2026-11-12T15:00:00Z',
    alerta_desviacion: false,
    severidad_desviacion: null,
    meta_lineal_esperada: 1420.0,
    desfase_porcentual: 3.49,
    mensaje_desviacion:
      'El avance se encuentra dentro del margen de tolerancia planificado.',
    serie_temporal: [
      { fecha: '2026-10-18', metros_dia: 95.0, metros_acumulados: 95.0 },
      { fecha: '2026-10-20', metros_dia: 140.0, metros_acumulados: 235.0 },
      { fecha: '2026-10-22', metros_dia: 180.5, metros_acumulados: 415.5 },
      { fecha: '2026-10-25', metros_dia: 210.0, metros_acumulados: 625.5 },
      { fecha: '2026-10-28', metros_dia: 175.0, metros_acumulados: 800.5 },
      { fecha: '2026-10-31', metros_dia: 190.0, metros_acumulados: 990.5 },
      { fecha: '2026-11-02', metros_dia: 230.0, metros_acumulados: 1220.5 },
      { fecha: '2026-11-05', metros_dia: 150.0, metros_acumulados: 1370.5 },
    ],
  },
  2: {
    linea_id: 2,
    nombre_linea: 'Línea Fondeo 2 — Bahía Sur (En Desfase)',
    estado_linea: 'activa',
    metros_totales: 2500,
    metros_acumulados: 920.0,
    metros_restantes: 1580.0,
    porcentaje_avance: 36.8,
    promedio_diario_7d: 42.5,
    dias_estimados_termino: 38,
    fecha_estimada_termino: '2026-12-14T18:00:00Z',
    alerta_desviacion: true,
    severidad_desviacion: 'ALTA',
    meta_lineal_esperada: 2150.0,
    desfase_porcentual: 57.21,
    mensaje_desviacion:
      'Desviación detectada: avance real (920.0 m) con desfase del 57.2% respecto a la meta esperada (2150.0 m). La fecha estimada supera la fecha meta planificada.',
    serie_temporal: [
      { fecha: '2026-09-20', metros_dia: 120.0, metros_acumulados: 120.0 },
      { fecha: '2026-09-28', metros_dia: 150.0, metros_acumulados: 270.0 },
      { fecha: '2026-10-08', metros_dia: 110.0, metros_acumulados: 380.0 },
      { fecha: '2026-10-15', metros_dia: 95.0, metros_acumulados: 475.0 },
      { fecha: '2026-10-23', metros_dia: 145.0, metros_acumulados: 620.0 },
      { fecha: '2026-10-29', metros_dia: 130.0, metros_acumulados: 750.0 },
      { fecha: '2026-11-03', metros_dia: 85.0, metros_acumulados: 835.0 },
      { fecha: '2026-11-05', metros_dia: 85.0, metros_acumulados: 920.0 },
    ],
  },
};

// --- Formateadores numéricos y de fechas ---
const formatNumber = (value, decimals = 1) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '0.0';
  }
  return Number(value).toLocaleString('es-CL', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

const formatDateShort = (isoString) => {
  if (!isoString) return 'No definida';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return 'Fecha inválida';
  return date.toLocaleDateString('es-CL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const formatChartDate = (dateStr) => {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    // Formato YYYY-MM-DD
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short' });
  }
  return dateStr;
};

// --- Subcomponente: Tarjeta KPI Gerencial ---
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
              border: badge.border ? `1px solid ${badge.border}` : 'none',
            }}
          >
            {badge.text}
          </span>
        )}
      </div>
      <div style={styles.kpiValue}>{value}</div>
      {subtitle && <div style={styles.kpiSubtitle}>{subtitle}</div>}
      {children && <div style={{ marginTop: '14px' }}>{children}</div>}
    </div>
  );
}

// --- Subcomponente: Tooltip interactivo con unidades 'm' ---
function CustomChartTooltip({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div style={styles.tooltipBox}>
      <p style={styles.tooltipTitle}>Jornada: {label}</p>
      {payload.map((entry) => (
        <div key={entry.dataKey} style={styles.tooltipRow}>
          <span
            style={{
              ...styles.tooltipDot,
              backgroundColor: entry.color || entry.fill || entry.stroke,
            }}
          />
          <span style={styles.tooltipLabel}>{entry.name}:</span>
          <strong style={styles.tooltipValue}>
            {formatNumber(entry.value, 1)} m
          </strong>
        </div>
      ))}
    </div>
  );
}

function Dashboard({ onLogout }) {
  // Estados principales
  const [lineas, setLineas] = useState([]);
  const [lineaSeleccionada, setLineaSeleccionada] = useState(null);
  const [datos, setDatos] = useState(null); // Resumen del dashboard
  const [cargando, setCargando] = useState(false);
  const [cargandoLineas, setCargandoLineas] = useState(true);
  const [error, setError] = useState(null);
  const [exportando, setExportando] = useState(false);
  const [tipoGrafico, setTipoGrafico] = useState('combinado'); // 'combinado' | 'lineas' | 'area' | 'barras'
  const [isDemoMode, setIsDemoMode] = useState(false);

  // Cerrar sesión
  const handleLogout = useCallback(() => {
    localStorage.removeItem('token');
    if (onLogout) {
      onLogout();
    }
  }, [onLogout]);

  // Manejo centralizado de errores de API
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

  // Cargar datos en modo de demostración interactiva si el servidor local está offline
  const activarModoDemo = useCallback(
    (lineaIdInicial) => {
      setIsDemoMode(true);
      setError(null);
      setLineas(DEMO_LINEAS);
      const targetId = lineaIdInicial || DEMO_LINEAS[0].id;
      setLineaSeleccionada(targetId);
      setDatos(DEMO_RESUMENES[targetId] || DEMO_RESUMENES[1]);
      setCargando(false);
      setCargandoLineas(false);
    },
    []
  );

  // 1. Obtener la lista de líneas y el resumen inicial al montar
  useEffect(() => {
    let activo = true;

    const inicializarDashboard = async () => {
      setCargandoLineas(true);
      setError(null);
      try {
        const lineasData = await obtenerLineas();
        if (!activo) return;
        setIsDemoMode(false);
        const lista = Array.isArray(lineasData) ? lineasData : [];
        setLineas(lista);

        const initialTargetId = lista.length > 0 ? lista[0].id : '';
        setLineaSeleccionada(initialTargetId);

        setCargando(true);
        const resumenData = await obtenerResumenDashboard(initialTargetId);
        if (!activo) return;
        setDatos(resumenData);
        if (resumenData?.linea_id && initialTargetId === '') {
          setLineaSeleccionada(resumenData.linea_id);
        }
      } catch (err) {
        if (!activo) return;
        // Si no responde el servidor local, habilitar la vista de respaldo demo interactiva
        if (!err?.response) {
          activarModoDemo();
          return;
        }
        handleApiError(
          err,
          'No se pudo conectar con el servidor para obtener las líneas de fondeo.'
        );
      } finally {
        if (activo) {
          setCargandoLineas(false);
          setCargando(false);
        }
      }
    };

    inicializarDashboard();
    return () => {
      activo = false;
    };
  }, [handleApiError, activarModoDemo]);

  // 2. Recargar el resumen del dashboard según la línea seleccionada
  const recargarMetricas = useCallback(
    async (lineaId) => {
      if (isDemoMode) {
        if (lineaId && DEMO_RESUMENES[lineaId]) {
          setDatos(DEMO_RESUMENES[lineaId]);
        }
        return;
      }

      setCargando(true);
      setError(null);
      try {
        const resumenData = await obtenerResumenDashboard(lineaId);
        setDatos(resumenData);
        // Si no había línea seleccionada y el backend asignó una por defecto, sincronizar el selector
        if (resumenData?.linea_id && (lineaId === null || lineaId === undefined || lineaId === '')) {
          setLineaSeleccionada(resumenData.linea_id);
        }
      } catch (err) {
        handleApiError(
          err,
          'Error al sincronizar el resumen gerencial de la línea de fondeo.'
        );
      } finally {
        setCargando(false);
      }
    },
    [isDemoMode, handleApiError]
  );

  // Manejador de cambio de línea desde el selector
  const handleCambioLinea = async (nuevaLineaId) => {
    setLineaSeleccionada(nuevaLineaId);
    await recargarMetricas(nuevaLineaId);
  };

  // 3. Descargar reporte Excel
  const handleDescargarExcel = async () => {
    const idToDownload = lineaSeleccionada || datos?.linea_id;
    if (!idToDownload) return;

    if (isDemoMode) {
      const csv =
        'Fecha,Metros Dia,Metros Acumulados\n' +
        (datos?.serie_temporal || [])
          .map((p) => `${p.fecha},${p.metros_dia},${p.metros_acumulados}`)
          .join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `reporte_avance_linea_${idToDownload}_demo.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      return;
    }

    setExportando(true);
    setError(null);
    try {
      const blob = await descargarReporteExcel(idToDownload);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `reporte_avance_linea_${idToDownload}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      handleApiError(
        err,
        'No se pudo generar el archivo Excel. Verifica los permisos de usuario.'
      );
    } finally {
      setExportando(false);
    }
  };

  // Línea de fondeo actualmente seleccionada en el estado
  const lineaActual = useMemo(() => {
    if (!lineaSeleccionada && !datos?.linea_id) return null;
    const targetId = Number(lineaSeleccionada || datos?.linea_id);
    return lineas.find((l) => l.id === targetId) || null;
  }, [lineas, lineaSeleccionada, datos]);

  // Formatear datos de la serie temporal para Recharts
  const datosGrafico = useMemo(() => {
    if (!datos?.serie_temporal || datos.serie_temporal.length === 0) {
      return [];
    }
    return datos.serie_temporal.map((punto) => ({
      fechaOriginal: punto.fecha,
      fecha: formatChartDate(punto.fecha),
      metros_dia: Number(punto.metros_dia || 0),
      metros_acumulados: Number(punto.metros_acumulados || 0),
    }));
  }, [datos]);

  // Porcentaje acotado para la barra visual (0% a 100%)
  const porcentajeVisual = Math.min(
    100,
    Math.max(0, Number(datos?.porcentaje_avance || 0))
  );

  return (
    <div style={styles.container}>
      {/* Barra de Navegación y Cabecera Ejecutiva */}
      <header style={styles.header}>
        <div style={styles.brandContainer}>
          <div style={styles.brandIcon}>⚓</div>
          <div>
            <h1 style={styles.headerTitle}>Panel de Control Gerencial — Fondeo</h1>
            <p style={styles.headerSubtitle}>
              Monitoreo ejecutivo de KPIs, proyecciones a 7 días y control de cronograma
            </p>
          </div>
        </div>

        <div style={styles.controlsRow}>
          {/* Selector de Línea de Fondeo */}
          <div style={styles.selectorWrapper}>
            <label htmlFor="selector-linea" style={styles.selectorLabel}>
              Línea:
            </label>
            <select
              id="selector-linea"
              value={lineaSeleccionada ?? ''}
              onChange={(e) => {
                const val = e.target.value;
                const nuevoId = val === '' ? '' : Number(val);
                handleCambioLinea(nuevoId);
              }}
              disabled={cargandoLineas || cargando}
              style={styles.selectInput}
            >
              {lineas.length === 0 ? (
                <option value="">Línea activa por defecto</option>
              ) : (
                lineas.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.nombre} ({formatNumber(l.metros_totales, 0)} m)
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Botón de Actualizar Datos bajo demanda */}
          <button
            type="button"
            onClick={() => recargarMetricas(lineaSeleccionada)}
            disabled={cargando}
            style={styles.refreshButton}
            title="Recargar métricas y proyecciones desde el backend"
          >
            <RefreshIcon size={15} spinning={cargando} />
            <span>{cargando ? 'Actualizando...' : 'Actualizar datos'}</span>
          </button>

          {/* Botón Descargar Excel */}
          <button
            type="button"
            onClick={handleDescargarExcel}
            disabled={exportando || (!lineaSeleccionada && !datos?.linea_id)}
            style={styles.excelButton}
            title="Descargar informe oficial en Excel"
          >
            <DownloadIcon size={15} />
            <span>{exportando ? 'Exportando...' : 'Descargar Excel'}</span>
          </button>

          {/* Botón Cerrar Sesión */}
          <button
            type="button"
            onClick={handleLogout}
            style={styles.logoutButton}
            title="Cerrar sesión de usuario"
          >
            <LogOutIcon size={15} />
            <span>Salir</span>
          </button>
        </div>
      </header>

      {/* Contenido Principal */}
      <main style={styles.main}>
        {/* Banner informativo de modo demostración (cuando el backend local está inactivo) */}
        {isDemoMode && (
          <div style={styles.demoBanner}>
            <div>
              <strong>Modo de Demostración Activo: </strong>
              <span>
                No se detectó un servidor backend en línea en el puerto 8000. Mostrando datos
                de control simulados para inspección del tablero gerencial.
              </span>
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={styles.demoButton}
            >
              Reintentar Conexión API
            </button>
          </div>
        )}

        {/* Mensaje de Error */}
        {error && (
          <div style={styles.errorAlert} role="alert">
            <AlertTriangleIcon size={20} color="#b91c1c" />
            <div style={{ flex: 1 }}>
              <strong>Error de comunicación: </strong>
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={() => recargarMetricas(lineaSeleccionada)}
              style={styles.retryBtn}
            >
              Reintentar
            </button>
          </div>
        )}

        {/* Estado de Carga Inicial */}
        {(cargandoLineas || (cargando && !datos)) && (
          <div style={styles.loadingContainer}>
            <div style={styles.spinner} />
            <p style={{ margin: 0, color: '#475569', fontWeight: 500 }}>
              Calculando proyecciones y métricas consolidadas...
            </p>
          </div>
        )}

        {/* Visualización de Datos */}
        {datos && (
          <>
            {/* ======================================================== */}
            {/* BLOQUE DE ALERTA POR DESVIACIÓN DE CRONOGRAMA (CRÍTICO) */}
            {/* ======================================================== */}
            {datos.alerta_desviacion ? (
              <section
                style={
                  datos.severidad_desviacion === 'ALTA'
                    ? styles.alertBannerHigh
                    : styles.alertBannerMedium
                }
                role="alert"
                aria-live="polite"
              >
                <div style={styles.alertIconCircle}>
                  <AlertTriangleIcon size={24} color="#ffffff" />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={styles.alertHeaderRow}>
                    <h2 style={styles.alertMainHeading}>
                      Alerta operacional: El avance de la línea presenta un desfase
                      significativo respecto a la fecha meta estimada.
                    </h2>
                    <span
                      style={{
                        ...styles.severityBadge,
                        backgroundColor:
                          datos.severidad_desviacion === 'ALTA' ? '#991b1b' : '#b45309',
                      }}
                    >
                      Severidad {datos.severidad_desviacion || 'MEDIA'}
                    </span>
                  </div>

                  {/* Detalle provisto por el backend */}
                  <p style={styles.alertMessage}>
                    {datos.mensaje_desviacion ||
                      'El avance acumulado es inferior al 80% de la meta lineal teórica planificada a la fecha actual.'}
                  </p>

                  {/* Cifras de la desviación */}
                  <div style={styles.alertMetricsGrid}>
                    <div style={styles.alertMetricItem}>
                      <span style={styles.alertMetricLabel}>Desfase Porcentual</span>
                      <strong style={styles.alertMetricVal}>
                        {formatNumber(datos.desfase_porcentual, 1)}%
                      </strong>
                    </div>

                    <div style={styles.alertMetricItem}>
                      <span style={styles.alertMetricLabel}>Meta Esperada a la Fecha</span>
                      <strong style={styles.alertMetricVal}>
                        {datos.meta_lineal_esperada !== null &&
                        datos.meta_lineal_esperada !== undefined
                          ? `${formatNumber(datos.meta_lineal_esperada, 1)} m`
                          : 'No estimada'}
                      </strong>
                    </div>

                    <div style={styles.alertMetricItem}>
                      <span style={styles.alertMetricLabel}>Avance Real Instalado</span>
                      <strong style={styles.alertMetricVal}>
                        {formatNumber(datos.metros_acumulados, 1)} m
                      </strong>
                    </div>

                    <div style={styles.alertMetricItem}>
                      <span style={styles.alertMetricLabel}>Fecha Meta Pactada</span>
                      <strong style={styles.alertMetricVal}>
                        {lineaActual?.fecha_meta
                          ? formatDateShort(lineaActual.fecha_meta)
                          : 'No pactada'}
                      </strong>
                    </div>
                  </div>
                </div>
              </section>
            ) : (
              /* Banner positivo cuando el cronograma va en orden */
              <section style={styles.onTrackBanner}>
                <CheckCircleIcon size={22} color="#15803d" />
                <div style={{ flex: 1 }}>
                  <span style={styles.onTrackText}>
                    <strong>Cronograma dentro de los márgenes previstos: </strong>
                    La línea {datos.nombre_linea} no presenta desviaciones críticas respecto a
                    la meta lineal planificada.
                  </span>
                </div>
                {lineaActual?.fecha_meta && (
                  <span style={styles.onTrackMeta}>
                    Meta: {formatDateShort(lineaActual.fecha_meta)}
                  </span>
                )}
              </section>
            )}

            {/* ======================================================== */}
            {/* TARJETAS DE KPIS GERENCIALES (MÉTRICAS CLAVE)            */}
            {/* ======================================================== */}
            <section style={styles.kpiGrid}>
              {/* KPI 1: Avance General (%) */}
              <KpiCard
                title="Avance General"
                value={`${formatNumber(datos.porcentaje_avance, 1)}%`}
                subtitle={`Línea: ${datos.nombre_linea}`}
                badge={{
                  text: datos.estado_linea || 'Activa',
                  bg: datos.estado_linea === 'completada' ? '#dcfce7' : '#dbeafe',
                  color: datos.estado_linea === 'completada' ? '#15803d' : '#1d4ed8',
                }}
                accentColor="#2563eb"
              >
                <div style={styles.progressTrack}>
                  <div
                    style={{
                      ...styles.progressFill,
                      width: `${porcentajeVisual}%`,
                      backgroundColor:
                        porcentajeVisual >= 100
                          ? '#16a34a'
                          : datos.alerta_desviacion
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

              {/* KPI 2: Metros Instalados (Acumulados vs Totales) */}
              <KpiCard
                title="Metros Instalados"
                value={`${formatNumber(datos.metros_acumulados, 1)} m`}
                subtitle={`de ${formatNumber(datos.metros_totales, 1)} m totales`}
                badge={{
                  text: `${formatNumber(porcentajeVisual, 1)}% completado`,
                  bg: '#f1f5f9',
                  color: '#334155',
                }}
                accentColor="#0284c7"
              >
                <div style={styles.miniDetailRow}>
                  <span>Fondeo acumulado efectivo</span>
                  <strong>{formatNumber(datos.metros_acumulados, 1)} m</strong>
                </div>
              </KpiCard>

              {/* KPI 3: Metros Restantes */}
              <KpiCard
                title="Metros Restantes"
                value={`${formatNumber(datos.metros_restantes, 1)} m`}
                subtitle="Longitud pendiente por fondear en faena"
                badge={{
                  text:
                    datos.metros_restantes <= 0 ? 'Meta lograda' : 'Pendiente',
                  bg: datos.metros_restantes <= 0 ? '#dcfce7' : '#fef3c7',
                  color: datos.metros_restantes <= 0 ? '#166534' : '#92400e',
                }}
                accentColor="#f59e0b"
              >
                <div style={styles.miniDetailRow}>
                  <span>Por fondear</span>
                  <strong>{formatNumber(datos.metros_restantes, 1)} m</strong>
                </div>
              </KpiCard>

              {/* KPI 4: Ritmo de Faena (Promedio 7 días) */}
              <KpiCard
                title="Ritmo de Faena"
                value={`${formatNumber(datos.promedio_diario_7d, 1)} m/día`}
                subtitle="Promedio diario de los últimos 7 días con maniobra"
                badge={{
                  text:
                    datos.promedio_diario_7d > 0 ? 'Cuadrilla activa' : 'Sin faena reciente',
                  bg: datos.promedio_diario_7d > 0 ? '#ecfdf5' : '#fef2f2',
                  color: datos.promedio_diario_7d > 0 ? '#047857' : '#b91c1c',
                }}
                accentColor="#8b5cf6"
              >
                <div style={styles.miniDetailRow}>
                  <span>Velocidad operativa</span>
                  <strong>{formatNumber(datos.promedio_diario_7d, 1)} m/jornada</strong>
                </div>
              </KpiCard>

              {/* KPI 5: Fecha Estimada de Término */}
              <KpiCard
                title="Fecha Estimada de Término"
                value={
                  datos.metros_restantes <= 0
                    ? 'Completada'
                    : datos.fecha_estimada_termino
                    ? formatDateShort(datos.fecha_estimada_termino)
                    : 'Sin proyección'
                }
                subtitle={
                  datos.metros_restantes <= 0
                    ? 'Faena de fondeo 100% concluida'
                    : datos.dias_estimados_termino !== null &&
                      datos.dias_estimados_termino !== undefined
                    ? `Días proyectados: ~${datos.dias_estimados_termino} días a ritmo actual`
                    : 'Requiere faenas recientes para calcular proyección'
                }
                badge={
                  datos.alerta_desviacion
                    ? { text: 'Desfase crítico', bg: '#fee2e2', color: '#b91c1c' }
                    : { text: 'En plazo', bg: '#dcfce7', color: '#15803d' }
                }
                accentColor={datos.alerta_desviacion ? '#dc2626' : '#10b981'}
              >
                <div style={styles.miniDetailRow}>
                  <span>Fecha meta pactada</span>
                  <strong>
                    {lineaActual?.fecha_meta
                      ? formatDateShort(lineaActual.fecha_meta)
                      : 'No definida'}
                  </strong>
                </div>
              </KpiCard>
            </section>

            {/* ======================================================== */}
            {/* VISUALIZACIÓN GRÁFICA CON RECHARTS                       */}
            {/* ======================================================== */}
            <section style={styles.chartCard}>
              <div style={styles.chartHeader}>
                <div>
                  <h2 style={styles.chartTitle}>
                    Curva de Avance Acumulado y Producción Diaria
                  </h2>
                  <p style={styles.chartSubtitle}>
                    Evolución temporal del fondeo en terreno: metros acumulados versus
                    rendimiento de cada jornada (m)
                  </p>
                </div>

                {/* Selector interactivo de vista de gráfico */}
                <div style={styles.chartToggleGroup}>
                  {[
                    { id: 'combinado', label: 'Combinado (Área + Barras)' },
                    { id: 'lineas', label: 'Línea de Tendencia' },
                    { id: 'area', label: 'Área Acumulada' },
                    { id: 'barras', label: 'Barras Diarias' },
                  ].map((btn) => (
                    <button
                      key={btn.id}
                      type="button"
                      onClick={() => setTipoGrafico(btn.id)}
                      style={
                        tipoGrafico === btn.id
                          ? styles.chartToggleBtnActive
                          : styles.chartToggleBtn
                      }
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
              </div>

              {datosGrafico.length === 0 ? (
                <div style={styles.emptyChart}>
                  <p style={{ margin: 0, fontWeight: 600, color: '#475569' }}>
                    No se registran faenas de fondeo para graficar en esta línea.
                  </p>
                  <span style={{ fontSize: '13px', color: '#94a3b8' }}>
                    Los registros sincronizados desde la app móvil offline se reflejarán
                    aquí automáticamente.
                  </span>
                </div>
              ) : (
                <div style={{ width: '100%', height: 360 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    {tipoGrafico === 'combinado' ? (
                      <ComposedChart
                        data={datosGrafico}
                        margin={{ top: 15, right: 25, left: 10, bottom: 5 }}
                      >
                        <defs>
                          <linearGradient
                            id="colorAcumuladoGradient"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop offset="5%" stopColor="#2563eb" stopOpacity={0.35} />
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
                        <Legend
                          wrapperStyle={{ paddingTop: '12px' }}
                          formatter={(value) => (
                            <span style={{ color: '#334155', fontWeight: 600 }}>
                              {value}
                            </span>
                          )}
                        />
                        <Area
                          type="monotone"
                          dataKey="metros_acumulados"
                          name="Metros Acumulados"
                          stroke="#2563eb"
                          strokeWidth={2.5}
                          fill="url(#colorAcumuladoGradient)"
                        />
                        <Bar
                          dataKey="metros_dia"
                          name="Metros de la Jornada"
                          fill="#0ea5e9"
                          radius={[6, 6, 0, 0]}
                          maxBarSize={48}
                        />
                      </ComposedChart>
                    ) : tipoGrafico === 'lineas' ? (
                      <LineChart
                        data={datosGrafico}
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
                        <Legend wrapperStyle={{ paddingTop: '12px' }} />
                        <Line
                          type="monotone"
                          dataKey="metros_acumulados"
                          name="Metros Acumulados"
                          stroke="#2563eb"
                          strokeWidth={3}
                          dot={{ r: 4, fill: '#2563eb' }}
                          activeDot={{ r: 6 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="metros_dia"
                          name="Metros Jornada"
                          stroke="#10b981"
                          strokeWidth={2}
                          strokeDasharray="4 4"
                          dot={{ r: 3, fill: '#10b981' }}
                        />
                      </LineChart>
                    ) : tipoGrafico === 'area' ? (
                      <AreaChart
                        data={datosGrafico}
                        margin={{ top: 15, right: 25, left: 10, bottom: 5 }}
                      >
                        <defs>
                          <linearGradient
                            id="colorAreaSolo"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop offset="5%" stopColor="#2563eb" stopOpacity={0.4} />
                            <stop offset="95%" stopColor="#2563eb" stopOpacity={0.05} />
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
                        <Legend wrapperStyle={{ paddingTop: '12px' }} />
                        <Area
                          type="monotone"
                          dataKey="metros_acumulados"
                          name="Metros Acumulados"
                          stroke="#2563eb"
                          strokeWidth={3}
                          fill="url(#colorAreaSolo)"
                        />
                      </AreaChart>
                    ) : (
                      <ComposedChart
                        data={datosGrafico}
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
                        <Legend wrapperStyle={{ paddingTop: '12px' }} />
                        <Bar
                          dataKey="metros_dia"
                          name="Producción Diaria (m)"
                          fill="#0ea5e9"
                          radius={[6, 6, 0, 0]}
                          maxBarSize={56}
                        />
                      </ComposedChart>
                    )}
                  </ResponsiveContainer>
                </div>
              )}
            </section>

            {/* ======================================================== */}
            {/* SERIE TEMPORAL DETALLADA (TABLA DE CONTROL EJECUTIVO)    */}
            {/* ======================================================== */}
            <section style={styles.chartCard}>
              <div style={styles.chartHeader}>
                <div>
                  <h2 style={styles.chartTitle}>Bitácora Consolidada de Jornadas</h2>
                  <p style={styles.chartSubtitle}>
                    Detalle diario procesado para auditoría y trazabilidad del avance de obra
                  </p>
                </div>
                <span style={styles.countBadge}>
                  {datosGrafico.length} {datosGrafico.length === 1 ? 'jornada' : 'jornadas'}
                </span>
              </div>

              {datosGrafico.length === 0 ? (
                <div style={styles.emptyChart}>
                  <span>Sin registros consolidados en esta línea de fondeo.</span>
                </div>
              ) : (
                <div style={styles.tableResponsive}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>Fecha de Maniobra</th>
                        <th style={{ ...styles.th, textAlign: 'right' }}>
                          Metros de la Jornada
                        </th>
                        <th style={{ ...styles.th, textAlign: 'right' }}>
                          Avance Acumulado
                        </th>
                        <th style={{ ...styles.th, textAlign: 'right' }}>
                          % de la Meta Lineal
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {datosGrafico.map((punto, idx) => {
                        const porcentajePunto =
                          datos.metros_totales > 0
                            ? (punto.metros_acumulados / datos.metros_totales) * 100
                            : 0;
                        return (
                          <tr key={punto.fechaOriginal || idx} style={styles.tr}>
                            <td style={styles.td}>
                              <div style={{ fontWeight: 600, color: '#0f172a' }}>
                                {punto.fechaOriginal}
                              </div>
                              <div style={{ fontSize: '11px', color: '#64748b' }}>
                                Maniobra N° {idx + 1}
                              </div>
                            </td>
                            <td
                              style={{
                                ...styles.td,
                                textAlign: 'right',
                                fontWeight: 700,
                                color: '#0369a1',
                              }}
                            >
                              +{formatNumber(punto.metros_dia, 1)} m
                            </td>
                            <td
                              style={{
                                ...styles.td,
                                textAlign: 'right',
                                fontWeight: 700,
                                color: '#1e3a8a',
                              }}
                            >
                              {formatNumber(punto.metros_acumulados, 1)} m
                            </td>
                            <td style={{ ...styles.td, textAlign: 'right' }}>
                              <span style={styles.progressPercentPill}>
                                {formatNumber(porcentajePunto, 1)}%
                              </span>
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

// --- Estilos CSS en JS optimizados para Escritorio y Tablets ---
const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#f8fafc',
    color: '#0f172a',
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    paddingBottom: '50px',
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
    boxShadow: '0 1px 3px rgba(15, 23, 42, 0.05)',
  },
  brandContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  brandIcon: {
    width: '42px',
    height: '42px',
    borderRadius: '10px',
    background: 'linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%)',
    color: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '22px',
    boxShadow: '0 2px 4px rgba(37, 99, 235, 0.2)',
  },
  headerTitle: {
    margin: 0,
    fontSize: '20px',
    fontWeight: 700,
    color: '#0f172a',
    letterSpacing: '-0.3px',
  },
  headerSubtitle: {
    margin: '3px 0 0 0',
    fontSize: '13px',
    color: '#64748b',
  },
  controlsRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '10px',
  },
  selectorWrapper: {
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
    fontSize: '13.5px',
    fontWeight: 600,
    color: '#0f172a',
    outline: 'none',
    cursor: 'pointer',
  },
  refreshButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '7px',
    padding: '8px 14px',
    borderRadius: '8px',
    border: '1px solid #cbd5e1',
    backgroundColor: '#ffffff',
    color: '#1e293b',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  excelButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '7px',
    padding: '8px 16px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#059669',
    color: '#ffffff',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    boxShadow: '0 1px 2px rgba(5, 150, 105, 0.25)',
  },
  logoutButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 13px',
    borderRadius: '8px',
    border: '1px solid #fecaca',
    backgroundColor: '#fef2f2',
    color: '#dc2626',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  main: {
    maxWidth: '1340px',
    margin: '24px auto 0',
    padding: '0 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '22px',
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
  demoButton: {
    padding: '6px 12px',
    borderRadius: '6px',
    border: '1px solid #93c5fd',
    backgroundColor: '#ffffff',
    color: '#1d4ed8',
    fontWeight: 600,
    fontSize: '12.5px',
    cursor: 'pointer',
  },
  errorAlert: {
    backgroundColor: '#fef2f2',
    border: '1px solid #fecaca',
    color: '#991b1b',
    padding: '14px 18px',
    borderRadius: '10px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    fontSize: '14px',
  },
  retryBtn: {
    padding: '6px 12px',
    borderRadius: '6px',
    border: '1px solid #f87171',
    backgroundColor: '#ffffff',
    color: '#b91c1c',
    fontWeight: 600,
    cursor: 'pointer',
  },
  loadingContainer: {
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
    animation: 'spin 0.8s linear infinite',
  },
  // Banners de Alerta por Desviación de Cronograma
  alertBannerHigh: {
    backgroundColor: '#fff1f2',
    border: '1px solid #fda4af',
    borderLeft: '6px solid #dc2626',
    borderRadius: '12px',
    padding: '20px 22px',
    display: 'flex',
    alignItems: 'flex-start',
    gap: '16px',
    boxShadow: '0 3px 8px rgba(220, 38, 38, 0.1)',
  },
  alertBannerMedium: {
    backgroundColor: '#fffbeb',
    border: '1px solid #fde68a',
    borderLeft: '6px solid #d97706',
    borderRadius: '12px',
    padding: '20px 22px',
    display: 'flex',
    alignItems: 'flex-start',
    gap: '16px',
    boxShadow: '0 3px 8px rgba(217, 119, 6, 0.1)',
  },
  alertIconCircle: {
    width: '40px',
    height: '40px',
    borderRadius: '10px',
    backgroundColor: '#dc2626',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  alertHeaderRow: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '6px',
  },
  alertMainHeading: {
    margin: 0,
    fontSize: '16px',
    fontWeight: 700,
    color: '#881337',
    lineHeight: 1.4,
  },
  severityBadge: {
    color: '#ffffff',
    fontSize: '11px',
    fontWeight: 700,
    padding: '3px 10px',
    borderRadius: '999px',
    letterSpacing: '0.5px',
    textTransform: 'uppercase',
  },
  alertMessage: {
    margin: '4px 0 14px 0',
    fontSize: '14px',
    color: '#9f1239',
    lineHeight: 1.5,
  },
  alertMetricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '10px',
    backgroundColor: '#ffffff',
    padding: '12px 16px',
    borderRadius: '8px',
    border: '1px solid #fecdd3',
  },
  alertMetricItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  alertMetricLabel: {
    fontSize: '11px',
    color: '#64748b',
    textTransform: 'uppercase',
    fontWeight: 600,
  },
  alertMetricVal: {
    fontSize: '15px',
    fontWeight: 700,
    color: '#0f172a',
  },
  // Banner de cronograma en orden
  onTrackBanner: {
    backgroundColor: '#f0fdf4',
    border: '1px solid #bbf7d0',
    borderLeft: '5px solid #16a34a',
    borderRadius: '10px',
    padding: '12px 18px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    fontSize: '13.5px',
    color: '#166534',
  },
  onTrackText: {
    lineHeight: 1.4,
  },
  onTrackMeta: {
    fontSize: '12px',
    fontWeight: 600,
    backgroundColor: '#dcfce7',
    padding: '4px 10px',
    borderRadius: '6px',
    color: '#15803d',
  },
  // Grilla de KPIs
  kpiGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: '16px',
  },
  kpiCard: {
    backgroundColor: '#ffffff',
    borderRadius: '12px',
    border: '1px solid #e2e8f0',
    padding: '20px',
    position: 'relative',
    overflow: 'hidden',
    boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
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
    marginBottom: '8px',
  },
  kpiTitle: {
    fontSize: '12.5px',
    fontWeight: 700,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.4px',
  },
  badge: {
    display: 'inline-block',
    padding: '3px 9px',
    borderRadius: '999px',
    fontSize: '11px',
    fontWeight: 700,
    textTransform: 'capitalize',
  },
  kpiValue: {
    fontSize: '28px',
    fontWeight: 800,
    color: '#0f172a',
    letterSpacing: '-0.5px',
    marginBottom: '4px',
  },
  kpiSubtitle: {
    fontSize: '12.5px',
    color: '#64748b',
    lineHeight: 1.4,
  },
  progressTrack: {
    width: '100%',
    height: '9px',
    backgroundColor: '#e2e8f0',
    borderRadius: '999px',
    overflow: 'hidden',
  },
  progressFill: {
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
  miniDetailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '12px',
    color: '#475569',
    backgroundColor: '#f8fafc',
    padding: '6px 10px',
    borderRadius: '6px',
    border: '1px solid #e2e8f0',
  },
  // Sección del gráfico
  chartCard: {
    backgroundColor: '#ffffff',
    borderRadius: '12px',
    border: '1px solid #e2e8f0',
    padding: '22px 24px',
    boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
  },
  chartHeader: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '14px',
    marginBottom: '20px',
  },
  chartTitle: {
    margin: 0,
    fontSize: '17px',
    fontWeight: 700,
    color: '#0f172a',
  },
  chartSubtitle: {
    margin: '4px 0 0 0',
    fontSize: '13px',
    color: '#64748b',
  },
  chartToggleGroup: {
    display: 'flex',
    flexWrap: 'wrap',
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
  chartToggleBtnActive: {
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
  emptyChart: {
    padding: '48px 20px',
    textAlign: 'center',
    color: '#64748b',
    backgroundColor: '#f8fafc',
    borderRadius: '8px',
    border: '1px dashed #cbd5e1',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
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
  countBadge: {
    backgroundColor: '#f1f5f9',
    color: '#475569',
    padding: '4px 12px',
    borderRadius: '999px',
    fontSize: '12px',
    fontWeight: 600,
  },
  tableResponsive: {
    width: '100%',
    overflowX: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '13.5px',
  },
  th: {
    textAlign: 'left',
    padding: '12px 14px',
    backgroundColor: '#f8fafc',
    borderBottom: '2px solid #e2e8f0',
    color: '#475569',
    fontSize: '11.5px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.4px',
  },
  tr: {
    borderBottom: '1px solid #f1f5f9',
  },
  td: {
    padding: '12px 14px',
    verticalAlign: 'middle',
  },
  progressPercentPill: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '4px',
    backgroundColor: '#f1f5f9',
    color: '#334155',
    fontSize: '12px',
    fontWeight: 600,
  },
};

export default Dashboard;
