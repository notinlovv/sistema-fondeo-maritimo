import React, { useState, useEffect, useCallback } from 'react';
import {
  actualizarRegistro,
  eliminarRegistro,
  obtenerAuditoriaRegistro,
} from '../api';

// --- Formateadores de fecha y números ---
const formatFechaHora = (dateStr) => {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleString('es-CL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatNumber = (value, decimals = 1) => {
  if (value === null || value === undefined || isNaN(Number(value))) {
    return '0.0';
  }
  return Number(value).toLocaleString('es-CL', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

/**
 * Convierte cualquier string de fecha ISO o datetime a formato compatible con <input type="datetime-local" />
 * Formato requerido: YYYY-MM-DDTHH:mm
 */
const toInputDateTimeLocal = (dateStr) => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

/**
 * Parsea objetos o strings JSON de auditoría de forma segura.
 */
const safeParseJson = (data) => {
  if (!data) return null;
  if (typeof data === 'object') return data;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
};

/**
 * Componente para la gestión, auditoría y trazabilidad de registros individuales de fondeo.
 *
 * @param {Array} props.registros - Lista de registros individuales de fondeo.
 * @param {string} props.lineaNombre - Nombre de la línea de fondeo activa.
 * @param {Function} props.onMutacionExitosa - Callback al crear, editar o eliminar registros.
 */
export default function GestionRegistros({
  registros = [],
  lineaNombre = '',
  onMutacionExitosa = () => {},
}) {
  // Estados para modal de edición
  const [registroAEditar, setRegistroAEditar] = useState(null);
  const [formEdicion, setFormEdicion] = useState({
    metros_avanzados: '',
    fecha: '',
    latitud: '',
    longitud: '',
    observacion: '',
  });
  const [guardandoEdicion, setGuardandoEdicion] = useState(false);
  const [errorEdicion, setErrorEdicion] = useState(null);

  // Estados para modal de confirmación de eliminación
  const [registroAEliminar, setRegistroAEliminar] = useState(null);
  const [eliminando, setEliminando] = useState(false);
  const [errorEliminacion, setErrorEliminacion] = useState(null);

  // Estados para modal de historial de auditoría
  const [registroParaHistorial, setRegistroParaHistorial] = useState(null);
  const [historialAuditoria, setHistorialAuditoria] = useState([]);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);
  const [errorHistorial, setErrorHistorial] = useState(null);

  // --- Handlers de Edición ---
  const handleAbrirEdicion = (reg) => {
    setErrorEdicion(null);
    setRegistroAEditar(reg);
    setFormEdicion({
      metros_avanzados: reg.metros_avanzados ?? reg.metros_instalados ?? reg.metros ?? '',
      fecha: toInputDateTimeLocal(reg.fecha),
      latitud: reg.latitud ?? reg.lat ?? '',
      longitud: reg.longitud ?? reg.lon ?? reg.lng ?? '',
      observacion: reg.observacion ?? '',
    });
  };

  const handleCerrarEdicion = () => {
    if (guardandoEdicion) return;
    setRegistroAEditar(null);
    setErrorEdicion(null);
  };

  const handleGuardarEdicion = async (e) => {
    e.preventDefault();
    if (!registroAEditar) return;
    setGuardandoEdicion(true);
    setErrorEdicion(null);

    const regId = registroAEditar.id ?? registroAEditar.uuid;
    const fechaIso = formEdicion.fecha
      ? new Date(formEdicion.fecha).toISOString()
      : undefined;

    const payload = {
      metros_avanzados: Number(formEdicion.metros_avanzados),
      fecha: fechaIso,
      latitud: Number(formEdicion.latitud),
      longitud: Number(formEdicion.longitud),
      observacion: formEdicion.observacion ? formEdicion.observacion.trim() : undefined,
    };

    try {
      await actualizarRegistro(regId, payload);
      setRegistroAEditar(null);
      await onMutacionExitosa();
    } catch (err) {
      console.error('Error al actualizar registro de fondeo:', err);
      const status = err?.response?.status;
      if (status === 400) {
        setErrorEdicion('Datos inválidos. Verifica que las coordenadas y metros de fondeo sean correctos.');
      } else if (status === 403) {
        setErrorEdicion('Permisos insuficientes: Tu usuario no está autorizado para modificar registros.');
      } else if (status === 404) {
        setErrorEdicion('El registro no fue encontrado en el servidor.');
      } else {
        const detail = err?.response?.data?.detail;
        setErrorEdicion(typeof detail === 'string' ? detail : 'Ocurrió un error al actualizar el registro.');
      }
    } finally {
      setGuardandoEdicion(false);
    }
  };

  // --- Handlers de Eliminación ---
  const handleAbrirEliminar = (reg) => {
    setErrorEliminacion(null);
    setRegistroAEliminar(reg);
  };

  const handleCerrarEliminar = () => {
    if (eliminando) return;
    setRegistroAEliminar(null);
    setErrorEliminacion(null);
  };

  const handleConfirmarEliminar = async () => {
    if (!registroAEliminar) return;
    setEliminando(true);
    setErrorEliminacion(null);

    const regId = registroAEliminar.id ?? registroAEliminar.uuid;
    try {
      await eliminarRegistro(regId);
      setRegistroAEliminar(null);
      await onMutacionExitosa();
    } catch (err) {
      console.error('Error al eliminar registro de fondeo:', err);
      const status = err?.response?.status;
      if (status === 403) {
        setErrorEliminacion('Permisos insuficientes: No puedes eliminar registros auditados.');
      } else if (status === 404) {
        setErrorEliminacion('El registro no fue encontrado en el servidor.');
      } else {
        const detail = err?.response?.data?.detail;
        setErrorEliminacion(typeof detail === 'string' ? detail : 'No se pudo eliminar el registro.');
      }
    } finally {
      setEliminando(false);
    }
  };

  // --- Handlers de Historial de Auditoría ---
  const handleAbrirHistorial = useCallback(async (reg) => {
    setRegistroParaHistorial(reg);
    setCargandoHistorial(true);
    setErrorHistorial(null);
    setHistorialAuditoria([]);

    const regId = reg.id ?? reg.uuid;
    try {
      const data = await obtenerAuditoriaRegistro(regId);
      setHistorialAuditoria(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn('Error al obtener auditoría del registro:', err);
      setHistorialAuditoria([]);
      if (err?.response?.status !== 404) {
        setErrorHistorial('No se pudo cargar el historial de cambios de este registro.');
      }
    } finally {
      setCargandoHistorial(false);
    }
  }, []);

  const handleCerrarHistorial = () => {
    setRegistroParaHistorial(null);
    setErrorHistorial(null);
    setHistorialAuditoria([]);
  };

  // Manejo de tecla Escape para cerrar cualquier modal abierto
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (registroAEditar && !guardandoEdicion) setRegistroAEditar(null);
        if (registroAEliminar && !eliminando) setRegistroAEliminar(null);
        if (registroParaHistorial) setRegistroParaHistorial(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [registroAEditar, guardandoEdicion, registroAEliminar, eliminando, registroParaHistorial]);

  return (
    <section style={styles.cardContainer}>
      {/* Cabecera del Módulo */}
      <div style={styles.header}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2 style={styles.title}>Bitácora Individual de Registros de Fondeo</h2>
            <span style={styles.countBadge}>
              {registros.length} {registros.length === 1 ? 'registro' : 'registros'}
            </span>
          </div>
          <p style={styles.subtitle}>
            Control georreferenciado del muerto/ancla para {lineaNombre || 'la línea seleccionada'} con auditoría de cambios
          </p>
        </div>
      </div>

      {/* Tabla de Registros */}
      {registros.length === 0 ? (
        <div style={styles.emptyContainer}>
          <div style={{ fontSize: '30px' }}>⚓</div>
          <strong style={{ color: '#334155', fontSize: '14px' }}>
            No hay registros individuales de fondeo para esta línea.
          </strong>
          <span style={{ fontSize: '12.5px', color: '#94a3b8' }}>
            Los registros sincronizados por capitanes y cuadrillas en terreno aparecerán listados aquí.
          </span>
        </div>
      ) : (
        <div style={styles.tableResponsive}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Fecha y Hora</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Avance (m)</th>
                <th style={styles.th}>Coordenadas del Muerto</th>
                <th style={styles.th}>Área Designada</th>
                <th style={styles.th}>Observación</th>
                <th style={{ ...styles.th, textAlign: 'center' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {registros.map((reg, idx) => {
                const esFuera = reg.dentro_zona === false;
                const metros = reg.metros_avanzados ?? reg.metros_instalados ?? reg.metros ?? 0;
                const lat = Number(reg.latitud ?? reg.lat);
                const lon = Number(reg.longitud ?? reg.lon ?? reg.lng);

                return (
                  <tr key={reg.id || reg.uuid || idx} style={styles.tr}>
                    {/* Fecha y Hora */}
                    <td style={styles.td}>
                      <div style={{ fontWeight: 600, color: '#0f172a' }}>
                        {formatFechaHora(reg.fecha)}
                      </div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>
                        ID #{reg.id ?? reg.uuid?.slice(0, 8)}
                      </div>
                    </td>

                    {/* Avance (m) */}
                    <td
                      style={{
                        ...styles.td,
                        textAlign: 'right',
                        fontWeight: 700,
                        color: '#0369a1',
                      }}
                    >
                      +{formatNumber(metros, 1)} m
                    </td>

                    {/* Coordenadas del Muerto */}
                    <td style={styles.td}>
                      {!isNaN(lat) && !isNaN(lon) ? (
                        <div style={{ fontSize: '12.5px', fontFamily: 'monospace' }}>
                          <div>Lat: {lat.toFixed(5)}</div>
                          <div>Lon: {lon.toFixed(5)}</div>
                        </div>
                      ) : (
                        <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>Sin coordenadas</span>
                      )}
                    </td>

                    {/* Área Designada */}
                    <td style={styles.td}>
                      {esFuera ? (
                        <span style={styles.badgeFueraZona}>
                          ⚠️ FUERA DE ZONA (Riesgo multa)
                        </span>
                      ) : (
                        <span style={styles.badgeEnZona}>
                          ✓ En zona
                        </span>
                      )}
                    </td>

                    {/* Observación */}
                    <td style={{ ...styles.td, maxWidth: '240px' }}>
                      <span
                        style={{
                          fontSize: '12.5px',
                          color: reg.observacion ? '#334155' : '#94a3b8',
                          fontStyle: reg.observacion ? 'normal' : 'italic',
                        }}
                      >
                        {reg.observacion || '—'}
                      </span>
                    </td>

                    {/* Acciones */}
                    <td style={{ ...styles.td, textAlign: 'center' }}>
                      <div style={styles.actionsBtnGroup}>
                        <button
                          type="button"
                          onClick={() => handleAbrirEdicion(reg)}
                          style={styles.editBtn}
                          title="Editar metros, fecha, coordenadas u observación"
                        >
                          ✏️ Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAbrirEliminar(reg)}
                          style={styles.deleteBtn}
                          title="Eliminar registro con trazabilidad"
                        >
                          🗑️ Eliminar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAbrirHistorial(reg)}
                          style={styles.historyBtn}
                          title="Ver bitácora de auditoría de este registro"
                        >
                          📜 Historial
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 1: EDICIÓN DE REGISTRO                            */}
      {/* ======================================================== */}
      {registroAEditar && (
        <div style={styles.modalOverlay} onClick={(e) => e.target === e.currentTarget && handleCerrarEdicion()}>
          <div style={styles.modalContent} role="dialog" aria-modal="true">
            <div style={styles.modalHeader}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '20px' }}>✏️</span>
                <h3 style={styles.modalTitle}>Editar Registro de Fondeo</h3>
              </div>
              <button
                type="button"
                onClick={handleCerrarEdicion}
                disabled={guardandoEdicion}
                style={styles.closeBtn}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleGuardarEdicion} style={styles.form}>
              {errorEdicion && (
                <div style={styles.errorBox} role="alert">
                  <strong>Error: </strong> {errorEdicion}
                </div>
              )}

              <div style={styles.formRow}>
                {/* Metros Avanzados */}
                <div style={styles.formGroup}>
                  <label htmlFor="edit-metros" style={styles.label}>
                    Avance de Fondeo (metros) *
                  </label>
                  <input
                    id="edit-metros"
                    type="number"
                    step="0.1"
                    min="0"
                    required
                    value={formEdicion.metros_avanzados}
                    onChange={(e) =>
                      setFormEdicion({ ...formEdicion, metros_avanzados: e.target.value })
                    }
                    disabled={guardandoEdicion}
                    style={styles.input}
                    placeholder="Ej. 150.5"
                  />
                </div>

                {/* Fecha y Hora */}
                <div style={styles.formGroup}>
                  <label htmlFor="edit-fecha" style={styles.label}>
                    Fecha y Hora de Maniobra *
                  </label>
                  <input
                    id="edit-fecha"
                    type="datetime-local"
                    required
                    value={formEdicion.fecha}
                    onChange={(e) =>
                      setFormEdicion({ ...formEdicion, fecha: e.target.value })
                    }
                    disabled={guardandoEdicion}
                    style={styles.input}
                  />
                </div>
              </div>

              <div style={styles.formRow}>
                {/* Latitud */}
                <div style={styles.formGroup}>
                  <label htmlFor="edit-lat" style={styles.label}>
                    Latitud del Muerto *
                  </label>
                  <input
                    id="edit-lat"
                    type="number"
                    step="any"
                    required
                    value={formEdicion.latitud}
                    onChange={(e) =>
                      setFormEdicion({ ...formEdicion, latitud: e.target.value })
                    }
                    disabled={guardandoEdicion}
                    style={styles.input}
                    placeholder="Ej. -39.8655"
                  />
                </div>

                {/* Longitud */}
                <div style={styles.formGroup}>
                  <label htmlFor="edit-lon" style={styles.label}>
                    Longitud del Muerto *
                  </label>
                  <input
                    id="edit-lon"
                    type="number"
                    step="any"
                    required
                    value={formEdicion.longitud}
                    onChange={(e) =>
                      setFormEdicion({ ...formEdicion, longitud: e.target.value })
                    }
                    disabled={guardandoEdicion}
                    style={styles.input}
                    placeholder="Ej. -73.4262"
                  />
                </div>
              </div>

              {/* Observación */}
              <div style={styles.formGroup}>
                <label htmlFor="edit-observacion" style={styles.label}>
                  Observación de Faena (Opcional)
                </label>
                <textarea
                  id="edit-observacion"
                  rows={3}
                  value={formEdicion.observacion}
                  onChange={(e) =>
                    setFormEdicion({ ...formEdicion, observacion: e.target.value })
                  }
                  disabled={guardandoEdicion}
                  style={styles.textarea}
                  placeholder="Detalles de maniobra, condiciones de oleaje o marea..."
                />
              </div>

              <div style={styles.modalActions}>
                <button
                  type="button"
                  onClick={handleCerrarEdicion}
                  disabled={guardandoEdicion}
                  style={styles.secondaryBtn}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardandoEdicion}
                  style={styles.primaryBtn}
                >
                  {guardandoEdicion ? 'Guardando...' : 'Guardar Cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 2: CONFIRMACIÓN DE ELIMINACIÓN                    */}
      {/* ======================================================== */}
      {registroAEliminar && (
        <div style={styles.modalOverlay} onClick={(e) => e.target === e.currentTarget && handleCerrarEliminar()}>
          <div style={{ ...styles.modalContent, maxWidth: '480px' }} role="dialog" aria-modal="true">
            <div style={styles.modalHeader}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '22px' }}>⚠️</span>
                <h3 style={{ ...styles.modalTitle, color: '#991b1b' }}>
                  Confirmar Eliminación de Registro
                </h3>
              </div>
              <button
                type="button"
                onClick={handleCerrarEliminar}
                disabled={eliminando}
                style={styles.closeBtn}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {errorEliminacion && (
                <div style={styles.errorBox} role="alert">
                  <strong>Error: </strong> {errorEliminacion}
                </div>
              )}

              <p style={{ margin: 0, fontSize: '13.5px', color: '#334155', lineHeight: 1.5 }}>
                ¿Estás seguro de que deseas eliminar este registro de avance de fondeo?
              </p>

              <div style={styles.detailSummaryBox}>
                <div>
                  <strong>Fecha:</strong> {formatFechaHora(registroAEliminar.fecha)}
                </div>
                <div>
                  <strong>Metros fondeados:</strong>{' '}
                  {registroAEliminar.metros_avanzados ?? registroAEliminar.metros_instalados ?? registroAEliminar.metros ?? 0} m
                </div>
                <div>
                  <strong>Coordenadas:</strong>{' '}
                  {registroAEliminar.latitud}, {registroAEliminar.longitud}
                </div>
              </div>

              <div style={styles.auditWarningNotice}>
                <strong>Aviso de Auditoría:</strong> El borrado de este registro quedará registrado permanentemente en la bitácora de auditoría con tu nombre de usuario, fecha y valores eliminados.
              </div>

              <div style={styles.modalActions}>
                <button
                  type="button"
                  onClick={handleCerrarEliminar}
                  disabled={eliminando}
                  style={styles.secondaryBtn}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmarEliminar}
                  disabled={eliminando}
                  style={styles.dangerBtn}
                >
                  {eliminando ? 'Eliminando...' : 'Sí, Eliminar Registro'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 3: HISTORIAL DE AUDITORÍA DEL REGISTRO            */}
      {/* ======================================================== */}
      {registroParaHistorial && (
        <div style={styles.modalOverlay} onClick={(e) => e.target === e.currentTarget && handleCerrarHistorial()}>
          <div style={{ ...styles.modalContent, maxWidth: '640px' }} role="dialog" aria-modal="true">
            <div style={styles.modalHeader}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '20px' }}>📜</span>
                <div>
                  <h3 style={styles.modalTitle}>Historial de Auditoría del Registro</h3>
                  <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                    Registro ID #{registroParaHistorial.id ?? registroParaHistorial.uuid?.slice(0, 8)}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCerrarHistorial}
                style={styles.closeBtn}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: '20px 24px', maxHeight: '70vh', overflowY: 'auto' }}>
              {errorHistorial && (
                <div style={styles.errorBox} role="alert">
                  {errorHistorial}
                </div>
              )}

              {cargandoHistorial ? (
                <div style={styles.loadingBox}>Consultando bitácora de auditoría...</div>
              ) : historialAuditoria.length === 0 ? (
                <div style={styles.emptyContainer}>
                  <span style={{ fontSize: '28px' }}>📋</span>
                  <strong>Sin cambios registrados</strong>
                  <span style={{ fontSize: '12.5px', color: '#64748b' }}>
                    Este registro conserva sus valores originales desde la inserción inicial.
                  </span>
                </div>
              ) : (
                <div style={styles.timelineWrapper}>
                  {historialAuditoria.map((item, idx) => {
                    const accion = (item.accion || item.action || 'UPDATE').toUpperCase();
                    const antes = safeParseJson(item.valores_antes);
                    const despues = safeParseJson(item.valores_despues);

                    const accionBadgeColor =
                      accion === 'INSERT'
                        ? { bg: '#dcfce7', text: '#15803d', border: '#bbf7d0' }
                        : accion === 'DELETE'
                        ? { bg: '#fee2e2', text: '#b91c1c', border: '#fecaca' }
                        : { bg: '#dbeafe', text: '#1d4ed8', border: '#bfdbfe' };

                    return (
                      <div key={item.id || idx} style={styles.historyCard}>
                        <div style={styles.historyCardHeader}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span
                              style={{
                                ...styles.accionBadge,
                                backgroundColor: accionBadgeColor.bg,
                                color: accionBadgeColor.text,
                                border: `1px solid ${accionBadgeColor.border}`,
                              }}
                            >
                              {accion}
                            </span>
                            <strong style={{ fontSize: '13px', color: '#0f172a' }}>
                              {item.usuario_nombre || item.usuario || 'Operador'}
                            </strong>
                          </div>
                          <span style={{ fontSize: '11.5px', color: '#64748b' }}>
                            {formatFechaHora(item.created_at || item.fecha || item.timestamp)}
                          </span>
                        </div>

                        {/* Comparación de Valores */}
                        <div style={styles.diffBox}>
                          {accion === 'INSERT' && despues ? (
                            <div style={{ fontSize: '12px', color: '#166534' }}>
                              <div><strong>Valores creados:</strong></div>
                              <div>• Metros: {despues.metros_avanzados ?? despues.metros_instalados ?? '—'} m</div>
                              <div>• Coord: {despues.latitud}, {despues.longitud}</div>
                              {despues.observacion && <div>• Observación: "{despues.observacion}"</div>}
                            </div>
                          ) : accion === 'DELETE' && antes ? (
                            <div style={{ fontSize: '12px', color: '#991b1b' }}>
                              <div><strong>Valores eliminados:</strong></div>
                              <div>• Metros: {antes.metros_avanzados ?? antes.metros_instalados ?? '—'} m</div>
                              <div>• Coord: {antes.latitud}, {antes.longitud}</div>
                              {antes.observacion && <div>• Observación: "{antes.observacion}"</div>}
                            </div>
                          ) : antes || despues ? (
                            <div style={styles.diffGrid}>
                              {/* Metros */}
                              <div style={styles.diffRow}>
                                <span style={styles.diffKey}>Metros:</span>
                                <span style={styles.diffOld}>
                                  {antes?.metros_avanzados ?? antes?.metros_instalados ?? '—'} m
                                </span>
                                <span>→</span>
                                <span style={styles.diffNew}>
                                  {despues?.metros_avanzados ?? despues?.metros_instalados ?? '—'} m
                                </span>
                              </div>

                              {/* Coordenadas */}
                              <div style={styles.diffRow}>
                                <span style={styles.diffKey}>Coordenadas:</span>
                                <span style={styles.diffOld}>
                                  {antes ? `${antes.latitud}, ${antes.longitud}` : '—'}
                                </span>
                                <span>→</span>
                                <span style={styles.diffNew}>
                                  {despues ? `${despues.latitud}, ${despues.longitud}` : '—'}
                                </span>
                              </div>

                              {/* Observación */}
                              {(antes?.observacion || despues?.observacion) && (
                                <div style={styles.diffRow}>
                                  <span style={styles.diffKey}>Observación:</span>
                                  <span style={styles.diffOld}>
                                    "{antes?.observacion || 'Sin observación'}"
                                  </span>
                                  <span>→</span>
                                  <span style={styles.diffNew}>
                                    "{despues?.observacion || 'Sin observación'}"
                                  </span>
                                </div>
                              )}
                            </div>
                          ) : (
                            <span style={{ fontSize: '12px', color: '#64748b', fontStyle: 'italic' }}>
                              Detalles de mutación no disponibles.
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={handleCerrarHistorial}
                  style={styles.secondaryBtn}
                >
                  Cerrar Historial
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// Estilos de la tabla de registros y modales
const styles = {
  cardContainer: {
    backgroundColor: '#ffffff',
    borderRadius: '12px',
    border: '1px solid #e2e8f0',
    padding: '22px 24px',
    boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  header: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
  },
  title: {
    margin: 0,
    fontSize: '17px',
    fontWeight: 700,
    color: '#0f172a',
  },
  subtitle: {
    margin: '3px 0 0 0',
    fontSize: '13px',
    color: '#64748b',
  },
  countBadge: {
    backgroundColor: '#f1f5f9',
    color: '#334155',
    padding: '3px 10px',
    borderRadius: '999px',
    fontSize: '12px',
    fontWeight: 700,
  },
  emptyContainer: {
    padding: '40px 20px',
    textAlign: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: '8px',
    border: '1px dashed #cbd5e1',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '6px',
  },
  tableResponsive: {
    width: '100%',
    overflowX: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '13px',
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
  badgeEnZona: {
    display: 'inline-block',
    padding: '3px 8px',
    borderRadius: '4px',
    backgroundColor: '#dcfce7',
    color: '#15803d',
    fontSize: '11.5px',
    fontWeight: 700,
  },
  badgeFueraZona: {
    display: 'inline-block',
    padding: '3px 8px',
    borderRadius: '4px',
    backgroundColor: '#fee2e2',
    color: '#b91c1c',
    fontSize: '11.5px',
    fontWeight: 700,
  },
  actionsBtnGroup: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
  },
  editBtn: {
    border: '1px solid #cbd5e1',
    backgroundColor: '#ffffff',
    color: '#1e293b',
    padding: '5px 9px',
    borderRadius: '6px',
    fontSize: '11.5px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.1s ease',
  },
  deleteBtn: {
    border: '1px solid #fecaca',
    backgroundColor: '#fef2f2',
    color: '#dc2626',
    padding: '5px 9px',
    borderRadius: '6px',
    fontSize: '11.5px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.1s ease',
  },
  historyBtn: {
    border: '1px solid #bfdbfe',
    backgroundColor: '#eff6ff',
    color: '#2563eb',
    padding: '5px 9px',
    borderRadius: '6px',
    fontSize: '11.5px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.1s ease',
  },
  // Modales
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    padding: '20px',
  },
  modalContent: {
    backgroundColor: '#ffffff',
    borderRadius: '14px',
    maxWidth: '560px',
    width: '100%',
    boxShadow: '0 20px 40px rgba(15, 23, 42, 0.25)',
    border: '1px solid #e2e8f0',
    overflow: 'hidden',
  },
  modalHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '18px 24px',
    borderBottom: '1px solid #f1f5f9',
  },
  modalTitle: {
    margin: 0,
    fontSize: '16px',
    fontWeight: 700,
    color: '#0f172a',
  },
  closeBtn: {
    border: 'none',
    backgroundColor: '#f1f5f9',
    color: '#64748b',
    width: '30px',
    height: '30px',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: 700,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  form: {
    padding: '20px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  formRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '12px',
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  label: {
    fontSize: '12.5px',
    fontWeight: 600,
    color: '#334155',
  },
  input: {
    boxSizing: 'border-box',
    width: '100%',
    padding: '8px 12px',
    borderRadius: '7px',
    border: '1px solid #cbd5e1',
    fontSize: '13px',
    fontFamily: 'inherit',
    outline: 'none',
  },
  textarea: {
    boxSizing: 'border-box',
    width: '100%',
    padding: '8px 12px',
    borderRadius: '7px',
    border: '1px solid #cbd5e1',
    fontSize: '13px',
    fontFamily: 'inherit',
    lineHeight: 1.4,
    resize: 'vertical',
    outline: 'none',
  },
  errorBox: {
    backgroundColor: '#fef2f2',
    border: '1px solid #fecaca',
    color: '#991b1b',
    padding: '10px 14px',
    borderRadius: '8px',
    fontSize: '13px',
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px',
    marginTop: '6px',
  },
  secondaryBtn: {
    padding: '8px 16px',
    borderRadius: '7px',
    border: '1px solid #cbd5e1',
    backgroundColor: '#ffffff',
    color: '#334155',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  primaryBtn: {
    padding: '8px 18px',
    borderRadius: '7px',
    border: 'none',
    backgroundColor: '#2563eb',
    color: '#ffffff',
    fontSize: '13px',
    fontWeight: 700,
    cursor: 'pointer',
    boxShadow: '0 2px 4px rgba(37, 99, 235, 0.25)',
  },
  dangerBtn: {
    padding: '8px 18px',
    borderRadius: '7px',
    border: 'none',
    backgroundColor: '#dc2626',
    color: '#ffffff',
    fontSize: '13px',
    fontWeight: 700,
    cursor: 'pointer',
    boxShadow: '0 2px 4px rgba(220, 38, 38, 0.25)',
  },
  detailSummaryBox: {
    backgroundColor: '#f8fafc',
    padding: '12px 14px',
    borderRadius: '8px',
    border: '1px solid #e2e8f0',
    fontSize: '12.5px',
    color: '#334155',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  auditWarningNotice: {
    backgroundColor: '#fffbeb',
    border: '1px solid #fde68a',
    color: '#92400e',
    padding: '10px 12px',
    borderRadius: '8px',
    fontSize: '12px',
    lineHeight: 1.4,
  },
  loadingBox: {
    padding: '24px',
    textAlign: 'center',
    color: '#64748b',
    fontSize: '13px',
  },
  timelineWrapper: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  historyCard: {
    backgroundColor: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  historyCardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  accionBadge: {
    fontSize: '11px',
    fontWeight: 700,
    padding: '2px 7px',
    borderRadius: '4px',
    letterSpacing: '0.4px',
  },
  diffBox: {
    backgroundColor: '#ffffff',
    padding: '8px 12px',
    borderRadius: '6px',
    border: '1px solid #f1f5f9',
  },
  diffGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    fontSize: '12px',
  },
  diffRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  diffKey: {
    fontWeight: 600,
    color: '#475569',
    width: '90px',
  },
  diffOld: {
    color: '#991b1b',
    backgroundColor: '#fef2f2',
    padding: '1px 5px',
    borderRadius: '3px',
  },
  diffNew: {
    color: '#166534',
    backgroundColor: '#f0fdf4',
    padding: '1px 5px',
    borderRadius: '3px',
    fontWeight: 600,
  },
};