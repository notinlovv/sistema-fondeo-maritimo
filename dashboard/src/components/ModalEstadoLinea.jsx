import React, { useEffect, useState } from 'react';
import { actualizarLinea, obtenerAuditoriaLinea } from '../api';

// Categorías oficiales de estado con sus configuraciones visuales
const CATEGORIAS_ESTADO = [
  {
    id: 'activa',
    nombre: 'Activa / Operativa',
    color: '#16a34a',
    bg: '#f0fdf4',
    border: '#bbf7d0',
    icono: '🟢',
    descripcion: 'Faena en ejecución activa conforme al plan de fondeo.',
  },
  {
    id: 'pausada',
    nombre: 'Pausada',
    color: '#d97706',
    bg: '#fffbeb',
    border: '#fde68a',
    icono: '⏸️',
    descripcion: 'Operaciones detenidas temporalmente por clima, marea o logística.',
  },
  {
    id: 'mantencion',
    nombre: 'En Mantención',
    color: '#9333ea',
    bg: '#faf5ff',
    border: '#e9d5ff',
    icono: '🔧',
    descripcion: 'Inspección técnica o reemplazo de cabos, boyarines o anclas.',
  },
  {
    id: 'fuera_de_posicion',
    nombre: 'Fuera de Posición',
    color: '#dc2626',
    bg: '#fef2f2',
    border: '#fecaca',
    icono: '⚠️',
    descripcion: 'Muerto o cabo desplazado fuera del radio autorizado (riesgo de multa).',
  },
  {
    id: 'completada',
    nombre: 'Completada',
    color: '#2563eb',
    bg: '#eff6ff',
    border: '#bfdbfe',
    icono: '✅',
    descripcion: 'Instalación del 100% de metros concluida y verificada.',
  },
];

const formatDate = (isoString) => {
  if (!isoString) return 'Fecha no disponible';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return isoString;
  return d.toLocaleString('es-CL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/**
 * Modal interactivo en 2 pasos para cambio de estado y trazabilidad de líneas de fondeo.
 *
 * @param {object} props.linea - Línea de fondeo seleccionada.
 * @param {Function} props.onClose - Callback para cerrar el modal.
 * @param {Function} props.onEstadoActualizado - Callback tras actualizar exitosamente la línea.
 */
export default function ModalEstadoLinea({
  linea,
  onClose,
  onEstadoActualizado,
}) {
  const lineaId = linea?.id;

  // Estados del flujo en 2 pasos
  const [paso, setPaso] = useState(1); // 1 = Selección de categoría, 2 = Confirmación y descripción opcional
  const [estadoSeleccionado, setEstadoSeleccionado] = useState(() => linea?.estado || 'activa');
  const [descripcion, setDescripcion] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [errorGuardado, setErrorGuardado] = useState(null);
  const [exitoGuardado, setExitoGuardado] = useState(false);

  // Estados de auditoría
  const [auditoria, setAuditoria] = useState([]);
  const [cargandoAuditoria, setCargandoAuditoria] = useState(true);
  const [errorAuditoria, setErrorAuditoria] = useState(null);
  const [pestanaActiva, setPestanaActiva] = useState('formulario'); // 'formulario' | 'auditoria'

  // Sincronizar estado cuando cambia la línea seleccionada sin efecto secundario cascada
  const [prevLineaId, setPrevLineaId] = useState(lineaId);
  if (lineaId !== prevLineaId) {
    setPrevLineaId(lineaId);
    setEstadoSeleccionado(linea?.estado || 'activa');
    setPaso(1);
    setDescripcion('');
    setErrorGuardado(null);
    setExitoGuardado(false);
  }

  // Cargar historial de auditoría de la línea
  useEffect(() => {
    let activo = true;

    const cargarHistorial = async () => {
      if (!lineaId) {
        setCargandoAuditoria(false);
        return;
      }
      setCargandoAuditoria(true);
      setErrorAuditoria(null);
      try {
        const data = await obtenerAuditoriaLinea(lineaId);
        if (activo) {
          setAuditoria(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        if (activo) {
          setAuditoria([]);
          if (err?.response?.status !== 404) {
            setErrorAuditoria('No fue posible consultar el historial de auditoría.');
          }
        }
      } finally {
        if (activo) {
          setCargandoAuditoria(false);
        }
      }
    };

    cargarHistorial();

    return () => {
      activo = false;
    };
  }, [lineaId]);

  // Manejo de cierre con tecla Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !guardando) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, guardando]);

  if (!linea) return null;

  // Paso 1 -> Paso 2: Seleccionar categoría
  const handleSeleccionarCategoria = (catId) => {
    setEstadoSeleccionado(catId);
    setErrorGuardado(null);
    setPaso(2);
  };

  // Paso 2: Confirmar y guardar cambio de estado
  const handleGuardar = async (e) => {
    e.preventDefault();
    setGuardando(true);
    setErrorGuardado(null);

    const payload = {
      estado: estadoSeleccionado,
      descripcion: descripcion.trim() || undefined,
    };

    try {
      const lineaActualizada = await actualizarLinea(linea.id, payload);
      setExitoGuardado(true);

      // Notificar al componente padre
      if (onEstadoActualizado) {
        onEstadoActualizado(lineaActualizada || { ...linea, ...payload });
      }

      // Refrescar auditoría de forma reactiva
      try {
        const data = await obtenerAuditoriaLinea(linea.id);
        setAuditoria(Array.isArray(data) ? data : []);
      } catch {
        // Continuar si falla la consulta de auditoría posterior
      }

      // Cerrar modal automáticamente tras una breve confirmación visual
      setTimeout(() => {
        onClose();
      }, 700);
    } catch (err) {
      console.error('Error al actualizar el estado de la línea:', err);
      const serverMsg =
        err?.response?.data?.detail ||
        'Ocurrió un error al intentar actualizar el estado de la línea.';
      setErrorGuardado(typeof serverMsg === 'string' ? serverMsg : JSON.stringify(serverMsg));
    } finally {
      setGuardando(false);
    }
  };

  const categoriaActualObj = CATEGORIAS_ESTADO.find((c) => c.id === linea.estado);
  const categoriaSeleccionadaObj = CATEGORIAS_ESTADO.find((c) => c.id === estadoSeleccionado);

  return (
    <div style={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={styles.modalCard} role="dialog" aria-modal="true">
        {/* Cabecera del Modal */}
        <div style={styles.header}>
          <div style={styles.headerLeft}>
            <div style={styles.headerIcon}>⚓</div>
            <div>
              <h2 style={styles.title}>
                Gestión de Estado: {linea.nombre || `Línea #${linea.id}`}
              </h2>
              <div style={styles.currentStatusRow}>
                <span style={styles.currentStatusLabel}>Estado vigente: </span>
                <span
                  style={{
                    ...styles.statusBadge,
                    backgroundColor: categoriaActualObj?.bg || '#f1f5f9',
                    color: categoriaActualObj?.color || '#334155',
                    border: `1px solid ${categoriaActualObj?.border || '#cbd5e1'}`,
                  }}
                >
                  {categoriaActualObj?.icono} {categoriaActualObj?.nombre || linea.estado || 'Activa'}
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={guardando}
            style={styles.closeBtn}
            title="Cerrar ventana"
          >
            ✕
          </button>
        </div>

        {/* Pestañas de Navegación del Modal */}
        <div style={styles.tabsContainer}>
          <button
            type="button"
            onClick={() => setPestanaActiva('formulario')}
            style={
              pestanaActiva === 'formulario' ? styles.tabBtnActive : styles.tabBtn
            }
          >
            ✏️ Cambiar Estado {paso === 2 ? '(Paso 2 de 2)' : '(Paso 1 de 2)'}
          </button>
          <button
            type="button"
            onClick={() => setPestanaActiva('auditoria')}
            style={
              pestanaActiva === 'auditoria' ? styles.tabBtnActive : styles.tabBtn
            }
          >
            📜 Historial de Auditoría ({auditoria.length})
          </button>
        </div>

        {/* Contenido Principal */}
        <div style={styles.body}>
          {/* Mensajes de Alerta */}
          {errorGuardado && (
            <div style={styles.errorBox} role="alert">
              <strong>Error: </strong> {errorGuardado}
            </div>
          )}

          {exitoGuardado && (
            <div style={styles.successBox} role="status">
              ✓ Estado actualizado exitosamente en el servidor.
            </div>
          )}

          {/* VISTA 1: FORMULARIO EN 2 PASOS */}
          {pestanaActiva === 'formulario' && (
            <div>
              {paso === 1 ? (
                /* ======================================================== */
                /* PASO 1: SELECCIÓN DE CATEGORÍA                           */
                /* ======================================================== */
                <div>
                  <div style={styles.stepHeader}>
                    <span style={styles.stepPill}>Paso 1 de 2</span>
                    <h3 style={styles.stepTitle}>Selecciona la nueva categoría operativa</h3>
                    <p style={styles.stepSubtitle}>
                      Elige el estado que refleja la condición actual de la línea de fondeo:
                    </p>
                  </div>

                  <div style={styles.categoryGrid}>
                    {CATEGORIAS_ESTADO.map((cat) => {
                      const esVigente = linea.estado === cat.id;
                      const esSeleccionado = estadoSeleccionado === cat.id;

                      return (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => handleSeleccionarCategoria(cat.id)}
                          style={{
                            ...styles.categoryCard,
                            borderColor: esSeleccionado ? cat.color : '#e2e8f0',
                            backgroundColor: esSeleccionado ? cat.bg : '#ffffff',
                            boxShadow: esSeleccionado
                              ? `0 0 0 2px ${cat.color}33`
                              : '0 1px 3px rgba(0,0,0,0.03)',
                          }}
                        >
                          <div style={styles.cardTopRow}>
                            <div style={styles.cardTitleRow}>
                              <span style={{ fontSize: '18px' }}>{cat.icono}</span>
                              <strong style={{ ...styles.cardTitle, color: cat.color }}>
                                {cat.nombre}
                              </strong>
                            </div>
                            {esVigente && (
                              <span style={styles.vigenteTag}>Actual</span>
                            )}
                          </div>
                          <p style={styles.cardDesc}>{cat.descripcion}</p>
                          <div style={{ ...styles.cardActionHint, color: cat.color }}>
                            Seleccionar y continuar →
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                /* ======================================================== */
                /* PASO 2: DESCRIPCIÓN OPCIONAL Y CONFIRMACIÓN              */
                /* ======================================================== */
                <form onSubmit={handleGuardar}>
                  <div style={styles.stepHeader}>
                    <span style={styles.stepPill}>Paso 2 de 2</span>
                    <h3 style={styles.stepTitle}>Confirmación y Observaciones</h3>
                    <p style={styles.stepSubtitle}>
                      Revisa el estado elegido y añade notas operativas si corresponde.
                    </p>
                  </div>

                  {/* Resumen de la categoría seleccionada */}
                  <div
                    style={{
                      ...styles.selectedCategorySummary,
                      backgroundColor: categoriaSeleccionadaObj?.bg || '#f8fafc',
                      borderColor: categoriaSeleccionadaObj?.border || '#cbd5e1',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '24px' }}>{categoriaSeleccionadaObj?.icono}</span>
                      <div>
                        <div style={{ fontSize: '11px', textTransform: 'uppercase', color: '#64748b', fontWeight: 700 }}>
                          Nuevo estado a registrar
                        </div>
                        <strong
                          style={{
                            fontSize: '16px',
                            color: categoriaSeleccionadaObj?.color || '#0f172a',
                          }}
                        >
                          {categoriaSeleccionadaObj?.nombre}
                        </strong>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setPaso(1)}
                      disabled={guardando}
                      style={styles.backBtn}
                    >
                      ← Cambiar estado
                    </button>
                  </div>

                  {/* Campo de descripción explícitamente marcado como opcional */}
                  <div style={styles.formGroup}>
                    <label htmlFor="input-descripcion" style={styles.label}>
                      <span>Descripción u observación</span>
                      <span style={styles.optionalBadge}>(Opcional)</span>
                    </label>
                    <textarea
                      id="input-descripcion"
                      rows={3}
                      value={descripcion}
                      onChange={(e) => setDescripcion(e.target.value)}
                      disabled={guardando}
                      placeholder="Indica el motivo de la transición, condiciones meteorológicas, o notas para el equipo en faena... (Opcional)"
                      style={styles.textarea}
                    />
                    <span style={styles.fieldHint}>
                      Este texto quedará registrado en la bitácora de auditoría junto a tu usuario.
                    </span>
                  </div>

                  {/* Botones de acción */}
                  <div style={styles.actionsRow}>
                    <button
                      type="button"
                      onClick={() => setPaso(1)}
                      disabled={guardando}
                      style={styles.cancelBtn}
                    >
                      Volver
                    </button>

                    <button
                      type="submit"
                      disabled={guardando}
                      style={{
                        ...styles.submitBtn,
                        backgroundColor: categoriaSeleccionadaObj?.color || '#2563eb',
                      }}
                    >
                      {guardando ? (
                        <span>Guardando cambio...</span>
                      ) : (
                        <span>Guardar cambio de estado</span>
                      )}
                    </button>
                  </div>
                </form>
              )}

              {/* Registro reciente de auditoría al pie del formulario */}
              <div style={styles.bottomAuditPreview}>
                <div style={styles.previewHeader}>
                  <span style={styles.previewTitle}>Últimos cambios de estado</span>
                  <button
                    type="button"
                    onClick={() => setPestanaActiva('auditoria')}
                    style={styles.viewFullAuditLink}
                  >
                    Ver historial completo ({auditoria.length}) →
                  </button>
                </div>

                {cargandoAuditoria ? (
                  <div style={styles.auditLoading}>Cargando historial de cambios...</div>
                ) : auditoria.length === 0 ? (
                  <div style={styles.auditEmpty}>
                    No hay cambios de estado previos registrados para esta línea.
                  </div>
                ) : (
                  <div style={styles.timelineList}>
                    {auditoria.slice(0, 2).map((item, idx) => (
                      <div key={item.id || idx} style={styles.timelineItem}>
                        <div style={styles.timelineDot} />
                        <div style={styles.timelineContent}>
                          <div style={styles.timelineMeta}>
                            <strong>{item.usuario_nombre || item.usuario || 'Usuario de faena'}</strong>
                            <span style={styles.timelineDate}>
                              {formatDate(item.created_at || item.fecha || item.fecha_cambio)}
                            </span>
                          </div>
                          <div style={styles.timelineTransition}>
                            <span style={styles.statusPillMuted}>
                              {item.estado_anterior || 'Inicio'}
                            </span>
                            <span style={{ color: '#94a3b8' }}>→</span>
                            <span style={styles.statusPillNew}>
                              {item.estado_nuevo || item.estado || 'Actualizado'}
                            </span>
                          </div>
                          {item.descripcion && (
                            <p style={styles.timelineDesc}>"{item.descripcion}"</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* VISTA 2: PESTAÑA COMPLETA DE AUDITORÍA */}
          {pestanaActiva === 'auditoria' && (
            <div>
              <div style={styles.stepHeader}>
                <h3 style={styles.stepTitle}>Historial Completo de Auditoría</h3>
                <p style={styles.stepSubtitle}>
                  Trazabilidad de todas las modificaciones de estado realizadas en esta línea.
                </p>
              </div>

              {errorAuditoria && (
                <div style={styles.errorBox}>{errorAuditoria}</div>
              )}

              {cargandoAuditoria ? (
                <div style={styles.auditLoading}>Cargando bitácora de auditoría...</div>
              ) : auditoria.length === 0 ? (
                <div style={styles.emptyStateContainer}>
                  <div style={{ fontSize: '32px' }}>📋</div>
                  <strong style={{ color: '#334155' }}>Sin registros de cambios</strong>
                  <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
                    Esta línea conserva su estado inicial y no ha tenido transiciones registradas.
                  </p>
                </div>
              ) : (
                <div style={styles.fullAuditList}>
                  {auditoria.map((item, idx) => (
                    <div key={item.id || idx} style={styles.auditCard}>
                      <div style={styles.auditCardHeader}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={styles.userAvatar}>👤</span>
                          <div>
                            <strong style={{ fontSize: '13.5px', color: '#0f172a' }}>
                              {item.usuario_nombre || item.usuario || 'Operador de faena'}
                            </strong>
                            <div style={{ fontSize: '11px', color: '#64748b' }}>
                              {formatDate(item.created_at || item.fecha || item.fecha_cambio)}
                            </div>
                          </div>
                        </div>

                        <div style={styles.transitionBadgeContainer}>
                          <span style={styles.statusPillMuted}>
                            {item.estado_anterior || 'Inicio'}
                          </span>
                          <span style={{ color: '#64748b' }}>→</span>
                          <span style={styles.statusPillNew}>
                            {item.estado_nuevo || item.estado || 'Actualizado'}
                          </span>
                        </div>
                      </div>

                      <div style={styles.auditCardBody}>
                        <span style={styles.auditDescLabel}>Descripción / Observación:</span>
                        <p style={styles.auditDescText}>
                          {item.descripcion || item.observacion || item.motivo ? (
                            `"${item.descripcion || item.observacion || item.motivo}"`
                          ) : (
                            <em style={{ color: '#94a3b8' }}>Sin descripción registrada</em>
                          )}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Estilos modales y diseño de tarjetas
const styles = {
  overlay: {
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
  modalCard: {
    backgroundColor: '#ffffff',
    borderRadius: '16px',
    maxWidth: '680px',
    width: '100%',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 20px 40px rgba(15, 23, 42, 0.25)',
    border: '1px solid #e2e8f0',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    padding: '20px 24px 16px',
    borderBottom: '1px solid #f1f5f9',
    gap: '12px',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  headerIcon: {
    width: '40px',
    height: '40px',
    borderRadius: '10px',
    backgroundColor: '#eff6ff',
    color: '#2563eb',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '20px',
    border: '1px solid #bfdbfe',
    flexShrink: 0,
  },
  title: {
    margin: 0,
    fontSize: '17px',
    fontWeight: 700,
    color: '#0f172a',
  },
  currentStatusRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginTop: '4px',
  },
  currentStatusLabel: {
    fontSize: '12px',
    color: '#64748b',
  },
  statusBadge: {
    padding: '2px 8px',
    borderRadius: '999px',
    fontSize: '11px',
    fontWeight: 700,
  },
  closeBtn: {
    border: 'none',
    backgroundColor: '#f1f5f9',
    color: '#64748b',
    width: '32px',
    height: '32px',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 700,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabsContainer: {
    display: 'flex',
    backgroundColor: '#f8fafc',
    padding: '0 24px',
    borderBottom: '1px solid #e2e8f0',
    gap: '8px',
  },
  tabBtn: {
    border: 'none',
    backgroundColor: 'transparent',
    padding: '12px 14px',
    fontSize: '13px',
    fontWeight: 600,
    color: '#64748b',
    cursor: 'pointer',
    borderBottom: '2px solid transparent',
  },
  tabBtnActive: {
    border: 'none',
    backgroundColor: 'transparent',
    padding: '12px 14px',
    fontSize: '13px',
    fontWeight: 700,
    color: '#2563eb',
    cursor: 'pointer',
    borderBottom: '2px solid #2563eb',
  },
  body: {
    padding: '22px 24px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '18px',
  },
  errorBox: {
    backgroundColor: '#fef2f2',
    border: '1px solid #fecaca',
    color: '#991b1b',
    padding: '10px 14px',
    borderRadius: '8px',
    fontSize: '13px',
  },
  successBox: {
    backgroundColor: '#f0fdf4',
    border: '1px solid #bbf7d0',
    color: '#166534',
    padding: '10px 14px',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: 600,
  },
  stepHeader: {
    marginBottom: '16px',
  },
  stepPill: {
    display: 'inline-block',
    fontSize: '11px',
    fontWeight: 700,
    color: '#2563eb',
    backgroundColor: '#eff6ff',
    padding: '2px 8px',
    borderRadius: '4px',
    marginBottom: '6px',
    textTransform: 'uppercase',
  },
  stepTitle: {
    margin: '0 0 4px 0',
    fontSize: '16px',
    fontWeight: 700,
    color: '#0f172a',
  },
  stepSubtitle: {
    margin: 0,
    fontSize: '13px',
    color: '#64748b',
  },
  categoryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: '12px',
  },
  categoryCard: {
    border: '1px solid #e2e8f0',
    borderRadius: '10px',
    padding: '14px 16px',
    textAlign: 'left',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    gap: '8px',
  },
  cardTopRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  cardTitle: {
    fontSize: '14px',
  },
  vigenteTag: {
    fontSize: '10.5px',
    fontWeight: 700,
    backgroundColor: '#f1f5f9',
    color: '#475569',
    padding: '2px 6px',
    borderRadius: '4px',
  },
  cardDesc: {
    margin: 0,
    fontSize: '12px',
    color: '#64748b',
    lineHeight: 1.4,
  },
  cardActionHint: {
    fontSize: '11.5px',
    fontWeight: 600,
    marginTop: '4px',
  },
  selectedCategorySummary: {
    padding: '14px 18px',
    borderRadius: '10px',
    border: '1px solid #e2e8f0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '18px',
  },
  backBtn: {
    border: '1px solid #cbd5e1',
    backgroundColor: '#ffffff',
    color: '#334155',
    padding: '6px 12px',
    borderRadius: '6px',
    fontSize: '12.5px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    marginBottom: '20px',
  },
  label: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#334155',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  optionalBadge: {
    fontSize: '11.5px',
    color: '#059669',
    fontWeight: 600,
    backgroundColor: '#ecfdf5',
    padding: '1px 6px',
    borderRadius: '4px',
  },
  textarea: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    borderRadius: '8px',
    border: '1px solid #cbd5e1',
    fontSize: '13px',
    fontFamily: 'inherit',
    lineHeight: 1.5,
    resize: 'vertical',
    outline: 'none',
  },
  fieldHint: {
    fontSize: '11.5px',
    color: '#64748b',
  },
  actionsRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: '10px',
  },
  cancelBtn: {
    padding: '9px 18px',
    borderRadius: '8px',
    border: '1px solid #cbd5e1',
    backgroundColor: '#ffffff',
    color: '#334155',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  submitBtn: {
    padding: '9px 20px',
    borderRadius: '8px',
    border: 'none',
    color: '#ffffff',
    fontSize: '13px',
    fontWeight: 700,
    cursor: 'pointer',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.15)',
  },
  bottomAuditPreview: {
    marginTop: '22px',
    paddingTop: '16px',
    borderTop: '1px solid #f1f5f9',
  },
  previewHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '10px',
  },
  previewTitle: {
    fontSize: '12px',
    fontWeight: 700,
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: '0.3px',
  },
  viewFullAuditLink: {
    border: 'none',
    backgroundColor: 'transparent',
    color: '#2563eb',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    padding: 0,
  },
  auditLoading: {
    padding: '12px',
    fontSize: '12.5px',
    color: '#64748b',
    textAlign: 'center',
  },
  auditEmpty: {
    padding: '12px',
    fontSize: '12.5px',
    color: '#94a3b8',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  timelineList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  timelineItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    backgroundColor: '#f8fafc',
    padding: '8px 12px',
    borderRadius: '8px',
    border: '1px solid #e2e8f0',
  },
  timelineDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: '#3b82f6',
    marginTop: '5px',
    flexShrink: 0,
  },
  timelineContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  timelineMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '12px',
    color: '#0f172a',
  },
  timelineDate: {
    fontSize: '11px',
    color: '#64748b',
  },
  timelineTransition: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginTop: '2px',
  },
  statusPillMuted: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#64748b',
    backgroundColor: '#e2e8f0',
    padding: '1px 6px',
    borderRadius: '4px',
  },
  statusPillNew: {
    fontSize: '11px',
    fontWeight: 700,
    color: '#1d4ed8',
    backgroundColor: '#dbeafe',
    padding: '1px 6px',
    borderRadius: '4px',
  },
  timelineDesc: {
    margin: '4px 0 0 0',
    fontSize: '11.5px',
    color: '#475569',
    fontStyle: 'italic',
  },
  emptyStateContainer: {
    textAlign: 'center',
    padding: '36px 20px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
  },
  fullAuditList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  auditCard: {
    backgroundColor: '#f8fafc',
    borderRadius: '10px',
    border: '1px solid #e2e8f0',
    padding: '14px 16px',
  },
  auditCardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
    flexWrap: 'wrap',
    gap: '8px',
  },
  userAvatar: {
    fontSize: '16px',
  },
  transitionBadgeContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  auditCardBody: {
    backgroundColor: '#ffffff',
    padding: '10px 12px',
    borderRadius: '6px',
    border: '1px solid #f1f5f9',
  },
  auditDescLabel: {
    fontSize: '10.5px',
    fontWeight: 700,
    textTransform: 'uppercase',
    color: '#64748b',
  },
  auditDescText: {
    margin: '4px 0 0 0',
    fontSize: '12.5px',
    color: '#334155',
  },
};