import React, { useEffect, useMemo } from 'react';
import {
  MapContainer,
  TileLayer,
  Polygon,
  Circle,
  Polyline,
  Marker,
  Tooltip,
  Popup,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Corrección de los iconos por defecto de Leaflet para Vite (evita marcadores rotos 404)
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl,
  iconUrl,
  shadowUrl,
});

// Colores oficiales por estado de línea de fondeo
const COLOR_ESTADOS = {
  activa: '#16a34a',
  completada: '#2563eb',
  pausada: '#d97706',
  mantencion: '#9333ea',
  fuera_de_posicion: '#dc2626',
};

const LABELS_ESTADOS = {
  activa: 'Activa / Operativa',
  completada: 'Completada',
  pausada: 'Pausada',
  mantencion: 'En Mantención',
  fuera_de_posicion: 'Fuera de Posición',
};

const getColorEstado = (estado) => {
  if (!estado) return '#64748b';
  const norm = String(estado).toLowerCase().trim();
  return COLOR_ESTADOS[norm] || '#64748b';
};

// Coordenadas de respaldo (Bahía de Corral / Valdivia)
const FALLBACK_CENTER = [-39.867, -73.428];

/**
 * Componente interno que reposiciona dinámicamente el viewport de Leaflet
 * cuando cambian las coordenadas de la línea seleccionada.
 */
function ChangeMapView({ center, zoom = 14 }) {
  const map = useMap();
  const lat = center?.[0];
  const lon = center?.[1];

  useEffect(() => {
    if (lat !== undefined && lon !== undefined && !isNaN(lat) && !isNaN(lon)) {
      map.setView([lat, lon], zoom, { animate: true });
    }
  }, [lat, lon, zoom, map]);

  return null;
}

/**
 * Calcula el centro geométrico idóneo para el mapa según la línea activa o las líneas cargadas.
 */
function calcularCentroMapa(lineaActiva, lineas) {
  if (lineaActiva) {
    const latMuerto = Number(lineaActiva.lat_muerto);
    const lonMuerto = Number(lineaActiva.lon_muerto);
    const latInicio = Number(lineaActiva.lat_inicio);
    const lonInicio = Number(lineaActiva.lon_inicio);

    if (!isNaN(latInicio) && !isNaN(lonInicio) && !isNaN(latMuerto) && !isNaN(lonMuerto)) {
      return [(latInicio + latMuerto) / 2, (lonInicio + lonMuerto) / 2];
    }
    if (!isNaN(latMuerto) && !isNaN(lonMuerto)) {
      return [latMuerto, lonMuerto];
    }
    if (!isNaN(latInicio) && !isNaN(lonInicio)) {
      return [latInicio, lonInicio];
    }

    const vertices = parsearVerticesZona(lineaActiva.zona_designada);
    if (vertices && vertices.length >= 3) {
      const sumLat = vertices.reduce((acc, p) => acc + p[0], 0);
      const sumLon = vertices.reduce((acc, p) => acc + p[1], 0);
      return [sumLat / vertices.length, sumLon / vertices.length];
    }
  }

  if (Array.isArray(lineas)) {
    for (const l of lineas) {
      const lat = Number(l.lat_muerto ?? l.lat_inicio);
      const lon = Number(l.lon_muerto ?? l.lon_inicio);
      if (!isNaN(lat) && !isNaN(lon)) {
        return [lat, lon];
      }
    }
  }

  return FALLBACK_CENTER;
}

/**
 * Parsea el campo zona_designada admitiendo GeoJSON, arrays [lat, lon] o JSON string.
 */
function parsearVerticesZona(zona) {
  if (!zona) return null;
  let parsed = zona;

  if (typeof zona === 'string') {
    try {
      parsed = JSON.parse(zona);
    } catch {
      return null;
    }
  }

  // Soporte GeoJSON Feature o Polygon estándar
  if (parsed?.type === 'Feature' && parsed?.geometry) {
    parsed = parsed.geometry;
  }
  if (parsed?.type === 'Polygon' && Array.isArray(parsed?.coordinates)) {
    const ring = parsed.coordinates[0];
    if (Array.isArray(ring) && ring.length >= 3) {
      // GeoJSON almacena [lon, lat], Leaflet requiere [lat, lon]
      return ring.map((coord) => [Number(coord[1]), Number(coord[0])]);
    }
  }

  // Soporte array directo de coordenadas
  if (Array.isArray(parsed) && parsed.length >= 3) {
    const vertices = parsed
      .map((item) => {
        if (Array.isArray(item) && item.length >= 2) {
          return [Number(item[0]), Number(item[1])];
        }
        if (item && typeof item === 'object') {
          const lat = item.lat ?? item.latitude ?? item.y;
          const lon = item.lon ?? item.lng ?? item.longitude ?? item.x;
          return [Number(lat), Number(lon)];
        }
        return null;
      })
      .filter((p) => p && !isNaN(p[0]) && !isNaN(p[1]));

    if (vertices.length >= 3) {
      return vertices;
    }
  }

  return null;
}

// Icono personalizado para el punto objetivo del Muerto / Ancla
const iconoMuertoObjetivo = L.divIcon({
  className: 'custom-anchor-icon',
  html: `
    <div style="
      width: 32px;
      height: 32px;
      background: #0f172a;
      border: 2px solid #ffffff;
      border-radius: 50%;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      color: #ffffff;
      cursor: pointer;
    ">⚓</div>
  `,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
  popupAnchor: [0, -16],
});

// Icono para registros de fondeo dentro de zona autorizada (verde)
const iconoRegistroDentroZona = L.divIcon({
  className: 'custom-registro-dentro',
  html: `
    <div style="
      width: 16px;
      height: 16px;
      background-color: #16a34a;
      border: 2px solid #ffffff;
      border-radius: 50%;
      box-shadow: 0 1px 5px rgba(22, 163, 74, 0.5);
      cursor: pointer;
    "></div>
  `,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
  popupAnchor: [0, -8],
});

// Icono para registros de fondeo fuera de zona autorizada (rojo pulsante)
const iconoRegistroFueraZona = L.divIcon({
  className: 'custom-registro-fuera',
  html: `
    <div class="beacon-pulse-wrapper" style="position: relative; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; cursor: pointer;">
      <span class="beacon-pulse-ring"></span>
      <span style="
        position: relative;
        width: 14px;
        height: 14px;
        background-color: #dc2626;
        border: 2px solid #ffffff;
        border-radius: 50%;
        box-shadow: 0 2px 6px rgba(220, 38, 38, 0.6);
      "></span>
    </div>
  `,
  iconSize: [26, 26],
  iconAnchor: [13, 13],
  popupAnchor: [0, -13],
});

/**
 * Componente de Cartografía Náutica y Operacional de Fondeo.
 *
 * @param {Array} props.lineas - Lista completa de líneas de fondeo.
 * @param {number|string} [props.lineaSeleccionadaId] - ID de la línea actualmente seleccionada.
 * @param {Array} [props.registros] - Registros de faena de la línea activa.
 * @param {Function} [props.onClickLinea] - Callback al hacer click sobre una línea en el mapa.
 */
export default function MapaFondeo({
  lineas = [],
  lineaSeleccionadaId = null,
  registros = [],
  onClickLinea = () => {},
}) {
  // 1. Identificar la línea activa / seleccionada
  const lineaActiva = useMemo(() => {
    if (!lineaSeleccionadaId && lineas.length === 0) return null;
    if (lineaSeleccionadaId) {
      return lineas.find((l) => String(l.id) === String(lineaSeleccionadaId)) || null;
    }
    return lineas[0] || null;
  }, [lineas, lineaSeleccionadaId]);

  // 2. Determinar centro dinámico del mapa con fallback a Bahía de Corral
  const centroMapa = calcularCentroMapa(lineaActiva, lineas);

  return (
    <div style={styles.mapWrapper}>
      {/* Estilos CSS inline para la animación pulsante del marcador en alerta */}
      <style>{`
        @keyframes beacon-pulse {
          0% {
            transform: scale(0.85);
            opacity: 0.9;
          }
          70% {
            transform: scale(2.4);
            opacity: 0;
          }
          100% {
            transform: scale(2.4);
            opacity: 0;
          }
        }
        .beacon-pulse-ring {
          position: absolute;
          width: 100%;
          height: 100%;
          border-radius: 50%;
          background-color: rgba(220, 38, 38, 0.6);
          animation: beacon-pulse 1.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) infinite;
        }
        .leaflet-container {
          width: 100%;
          height: 100%;
          border-radius: 12px;
          font-family: inherit;
        }
      `}</style>

      <MapContainer
        center={centroMapa}
        zoom={14}
        scrollWheelZoom={true}
        style={{ width: '100%', height: '100%', minHeight: '460px' }}
      >
        <ChangeMapView center={centroMapa} zoom={14} />

        {/* Capa Base: OpenStreetMap */}
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />

        {/* Capa Náutica Superpuesta: OpenSeaMap (balizas, boyas, calados y luces de navegación) */}
        <TileLayer
          url="https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openseamap.org">OpenSeaMap</a>'
          maxZoom={18}
        />

        {/* ======================================================== */}
        {/* ÁREA DESIGNADA (POLÍGONO O CÍRCULO DE TOLERANCIA)        */}
        {/* ======================================================== */}
        {lineas.map((linea) => {
          const esActiva = String(linea.id) === String(lineaSeleccionadaId);
          const vertices = parsearVerticesZona(linea.zona_designada);
          const latMuerto = Number(linea.lat_muerto);
          const lonMuerto = Number(linea.lon_muerto);

          if (vertices && vertices.length >= 3) {
            return (
              <Polygon
                key={`zona-poly-${linea.id}`}
                positions={vertices}
                pathOptions={{
                  color: esActiva ? '#059669' : '#10b981',
                  fillColor: '#10b981',
                  fillOpacity: esActiva ? 0.22 : 0.12,
                  weight: esActiva ? 2.5 : 1.5,
                  dashArray: '6, 6',
                }}
              >
                <Tooltip sticky>
                  <div>
                    <strong>Área Designada Autorizada</strong>
                    <div style={{ fontSize: '11px', color: '#047857' }}>
                      Línea: {linea.nombre || `#${linea.id}`} — Zona sin riesgo de multa
                    </div>
                  </div>
                </Tooltip>
              </Polygon>
            );
          }

          // Si no tiene polígono pero tiene lat_muerto y lon_muerto, dibuja círculo de tolerancia
          if (!isNaN(latMuerto) && !isNaN(lonMuerto)) {
            const radioTolerancia = Number(linea.radio_tolerancia_m) || 50;
            return (
              <Circle
                key={`zona-circle-${linea.id}`}
                center={[latMuerto, lonMuerto]}
                radius={radioTolerancia}
                pathOptions={{
                  color: esActiva ? '#059669' : '#10b981',
                  fillColor: '#10b981',
                  fillOpacity: esActiva ? 0.2 : 0.1,
                  weight: esActiva ? 2 : 1.2,
                  dashArray: '5, 5',
                }}
              >
                <Tooltip sticky>
                  <div>
                    <strong>Área de Tolerancia ({radioTolerancia} m)</strong>
                    <div style={{ fontSize: '11px', color: '#047857' }}>
                      Línea: {linea.nombre || `#${linea.id}`} — Margen de fondeo sin multa
                    </div>
                  </div>
                </Tooltip>
              </Circle>
            );
          }

          return null;
        })}

        {/* ======================================================== */}
        {/* LÍNEAS DE FONDEO (POLYLINES)                             */}
        {/* ======================================================== */}
        {lineas.map((linea) => {
          const latInicio = Number(linea.lat_inicio);
          const lonInicio = Number(linea.lon_inicio);
          const latMuerto = Number(linea.lat_muerto);
          const lonMuerto = Number(linea.lon_muerto);

          if (
            isNaN(latInicio) ||
            isNaN(lonInicio) ||
            isNaN(latMuerto) ||
            isNaN(lonMuerto)
          ) {
            return null;
          }

          const esSeleccionada = String(linea.id) === String(lineaSeleccionadaId);
          const color = getColorEstado(linea.estado);
          const avance =
            linea.porcentaje_avance !== undefined && linea.porcentaje_avance !== null
              ? Number(linea.porcentaje_avance).toFixed(1)
              : linea.metros_totales > 0 && linea.metros_acumulados !== undefined
              ? ((linea.metros_acumulados / linea.metros_totales) * 100).toFixed(1)
              : '0.0';

          return (
            <React.Fragment key={`linea-grupo-${linea.id}`}>
              <Polyline
                positions={[
                  [latInicio, lonInicio],
                  [latMuerto, lonMuerto],
                ]}
                pathOptions={{
                  color,
                  weight: esSeleccionada ? 6 : 3.5,
                  opacity: esSeleccionada ? 1 : 0.75,
                }}
                eventHandlers={{
                  click: () => {
                    if (onClickLinea) {
                      onClickLinea(linea);
                    }
                  },
                }}
              >
                <Tooltip sticky>
                  <div style={{ minWidth: '150px' }}>
                    <strong style={{ fontSize: '13px', color: '#0f172a' }}>
                      {linea.nombre || `Línea #${linea.id}`}
                    </strong>
                    <div style={{ marginTop: '4px', fontSize: '12px' }}>
                      <span style={{ color: '#64748b' }}>Estado: </span>
                      <strong style={{ color }}>
                        {LABELS_ESTADOS[linea.estado] || linea.estado || 'Activa'}
                      </strong>
                    </div>
                    <div style={{ fontSize: '12px', marginTop: '2px' }}>
                      <span style={{ color: '#64748b' }}>Avance: </span>
                      <strong>{avance}%</strong>
                      {linea.metros_totales ? (
                        <span style={{ color: '#64748b', fontSize: '11px' }}>
                          {' '}
                          ({linea.metros_acumulados || 0} / {linea.metros_totales} m)
                        </span>
                      ) : null}
                    </div>
                    <div
                      style={{
                        marginTop: '6px',
                        fontSize: '11px',
                        color: '#2563eb',
                        fontWeight: 600,
                      }}
                    >
                      ⚡ Click para cambiar estado o ver auditoría
                    </div>
                  </div>
                </Tooltip>
              </Polyline>

              {/* Posición Objetivo del Muerto / Ancla */}
              <Marker
                position={[latMuerto, lonMuerto]}
                icon={iconoMuertoObjetivo}
              >
                <Tooltip sticky>
                  <div style={{ textAlign: 'center' }}>
                    <strong>Posición Objetivo del Muerto</strong>
                    <div style={{ fontSize: '11px', color: '#475569' }}>
                      {linea.nombre || `Línea #${linea.id}`}
                    </div>
                    <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px' }}>
                      Coord: {latMuerto.toFixed(5)}, {lonMuerto.toFixed(5)}
                    </div>
                  </div>
                </Tooltip>
                <Popup>
                  <div style={{ minWidth: '180px' }}>
                    <h4 style={{ margin: '0 0 6px 0', fontSize: '14px', color: '#0f172a' }}>
                      ⚓ Posición Objetivo del Muerto
                    </h4>
                    <p style={{ margin: '0 0 4px 0', fontSize: '12px', color: '#334155' }}>
                      <strong>Línea:</strong> {linea.nombre}
                    </p>
                    <p style={{ margin: '0 0 4px 0', fontSize: '12px', color: '#334155' }}>
                      <strong>Estado:</strong>{' '}
                      <span style={{ color, fontWeight: 700 }}>
                        {LABELS_ESTADOS[linea.estado] || linea.estado}
                      </span>
                    </p>
                    <p style={{ margin: 0, fontSize: '11px', color: '#64748b' }}>
                      Tolerancia autorizada: {linea.radio_tolerancia_m || 50} metros
                    </p>
                  </div>
                </Popup>
              </Marker>
            </React.Fragment>
          );
        })}

        {/* ======================================================== */}
        {/* REGISTROS DE FONDEO (LÍNEA ACTIVA)                      */}
        {/* ======================================================== */}
        {Array.isArray(registros) &&
          registros.map((reg, idx) => {
            const lat = Number(reg.latitud ?? reg.lat);
            const lon = Number(reg.longitud ?? reg.lon ?? reg.lng);

            if (isNaN(lat) || isNaN(lon)) return null;

            const esFueraDeZona = reg.dentro_zona === false;
            const icono = esFueraDeZona ? iconoRegistroFueraZona : iconoRegistroDentroZona;

            return (
              <Marker
                key={reg.uuid || reg.id || `reg-${idx}`}
                position={[lat, lon]}
                icon={icono}
              >
                <Tooltip sticky>
                  <div style={{ minWidth: '160px' }}>
                    {esFueraDeZona ? (
                      <div
                        style={{
                          backgroundColor: '#fee2e2',
                          color: '#b91c1c',
                          padding: '3px 6px',
                          borderRadius: '4px',
                          fontWeight: 700,
                          fontSize: '11.5px',
                          marginBottom: '4px',
                        }}
                      >
                        ⚠️ Alerta: Muerto fuera de área designada - Riesgo de multa
                      </div>
                    ) : (
                      <div
                        style={{
                          color: '#15803d',
                          fontWeight: 700,
                          fontSize: '12px',
                          marginBottom: '4px',
                        }}
                      >
                        ✓ Muerto dentro de área designada
                      </div>
                    )}
                    <div style={{ fontSize: '12px', color: '#334155' }}>
                      <strong>Metros instalados:</strong> {reg.metros_instalados ?? reg.metros ?? 0} m
                    </div>
                    {reg.fecha && (
                      <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                        Fecha: {reg.fecha} {reg.hora ? `(${reg.hora})` : ''}
                      </div>
                    )}
                  </div>
                </Tooltip>
                <Popup>
                  <div style={{ minWidth: '200px' }}>
                    <div
                      style={{
                        fontSize: '12px',
                        fontWeight: 700,
                        padding: '4px 8px',
                        borderRadius: '4px',
                        backgroundColor: esFueraDeZona ? '#fee2e2' : '#dcfce7',
                        color: esFueraDeZona ? '#991b1b' : '#166534',
                        marginBottom: '8px',
                      }}
                    >
                      {esFueraDeZona
                        ? 'Alerta: Muerto fuera de área designada - Riesgo de multa'
                        : 'Posición conforme a normativa'}
                    </div>
                    <div style={{ fontSize: '12px', color: '#1e293b', lineHeight: 1.5 }}>
                      <div>
                        <strong>Metros instalados:</strong> {reg.metros_instalados ?? reg.metros ?? 0} m
                      </div>
                      <div>
                        <strong>Latitud:</strong> {lat.toFixed(5)}
                      </div>
                      <div>
                        <strong>Longitud:</strong> {lon.toFixed(5)}
                      </div>
                      {reg.fecha && (
                        <div>
                          <strong>Fecha:</strong> {reg.fecha} {reg.hora || ''}
                        </div>
                      )}
                      {reg.observacion && (
                        <div style={{ marginTop: '4px', fontStyle: 'italic', color: '#475569' }}>
                          "{reg.observacion}"
                        </div>
                      )}
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}
      </MapContainer>

      {/* ======================================================== */}
      {/* LEYENDA FLOTANTE COMPACTA                                */}
      {/* ======================================================== */}
      <div style={styles.floatingLegend}>
        <div style={styles.legendHeader}>
          <span style={styles.legendTitle}>Leyenda Cartográfica</span>
        </div>

        {/* Estados de Línea */}
        <div style={styles.legendSection}>
          <div style={styles.legendSubheading}>Estado de Línea</div>
          <div style={styles.legendGrid}>
            {Object.entries(COLOR_ESTADOS).map(([estadoKey, color]) => (
              <div key={estadoKey} style={styles.legendItem}>
                <span
                  style={{
                    ...styles.colorDot,
                    backgroundColor: color,
                  }}
                />
                <span style={styles.legendLabel}>
                  {LABELS_ESTADOS[estadoKey] || estadoKey}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div style={styles.legendDivider} />

        {/* Señalética Náutica y Operativa */}
        <div style={styles.legendSection}>
          <div style={styles.legendSubheading}>Marcación de Fondeo</div>
          <div style={styles.legendGrid}>
            <div style={styles.legendItem}>
              <span style={styles.areaIndicatorBox} />
              <span style={styles.legendLabel}>Área Designada (Sin Multa)</span>
            </div>
            <div style={styles.legendItem}>
              <span style={styles.anchorSymbol}>⚓</span>
              <span style={styles.legendLabel}>Posición Objetivo Muerto</span>
            </div>
            <div style={styles.legendItem}>
              <span style={styles.greenDot} />
              <span style={styles.legendLabel}>Registro Conforme</span>
            </div>
            <div style={styles.legendItem}>
              <span style={styles.redPulseDot} />
              <span style={{ ...styles.legendLabel, color: '#dc2626', fontWeight: 600 }}>
                Fuera de Zona (Riesgo Multa)
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Estilos de la interfaz del mapa y leyenda flotante
const styles = {
  mapWrapper: {
    position: 'relative',
    width: '100%',
    height: '520px',
    borderRadius: '12px',
    overflow: 'hidden',
    border: '1px solid #cbd5e1',
    boxShadow: '0 2px 6px rgba(15, 23, 42, 0.08)',
    backgroundColor: '#e2e8f0',
  },
  floatingLegend: {
    position: 'absolute',
    bottom: '16px',
    left: '16px',
    zIndex: 1000,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    backdropFilter: 'blur(8px)',
    borderRadius: '10px',
    border: '1px solid rgba(203, 213, 225, 0.8)',
    padding: '12px 14px',
    boxShadow: '0 4px 14px rgba(15, 23, 42, 0.12)',
    maxWidth: '280px',
    fontSize: '11.5px',
    color: '#1e293b',
    pointerEvents: 'auto',
  },
  legendHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '8px',
  },
  legendTitle: {
    fontWeight: 700,
    fontSize: '12px',
    color: '#0f172a',
    textTransform: 'uppercase',
    letterSpacing: '0.4px',
  },
  legendSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  legendSubheading: {
    fontSize: '10px',
    fontWeight: 700,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.3px',
    marginBottom: '2px',
  },
  legendGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
  },
  colorDot: {
    width: '12px',
    height: '4px',
    borderRadius: '2px',
    flexShrink: 0,
  },
  legendLabel: {
    fontSize: '11px',
    color: '#334155',
  },
  legendDivider: {
    height: '1px',
    backgroundColor: '#e2e8f0',
    margin: '8px 0',
  },
  areaIndicatorBox: {
    width: '12px',
    height: '10px',
    border: '1.5px dashed #059669',
    backgroundColor: 'rgba(16, 185, 129, 0.25)',
    borderRadius: '2px',
    flexShrink: 0,
  },
  anchorSymbol: {
    fontSize: '12px',
    lineHeight: 1,
    flexShrink: 0,
  },
  greenDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: '#16a34a',
    flexShrink: 0,
  },
  redPulseDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: '#dc2626',
    flexShrink: 0,
    boxShadow: '0 0 0 2px rgba(220, 38, 38, 0.3)',
  },
};