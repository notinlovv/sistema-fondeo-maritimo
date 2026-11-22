/**
 * Módulo de validación geoespacial pura para operaciones de fondeo.
 * Implementa la misma lógica de negocio y algoritmos espaciales que el backend FastAPI.
 */

export interface LineaGeometria {
  id?: number;
  nombre?: string;
  estado?: string | null;
  metros_totales?: number | null;
  lat_inicio?: number | null;
  lon_inicio?: number | null;
  lat_muerto?: number | null;
  lon_muerto?: number | null;
  radio_tolerancia_m?: number | null;
  zona_designada?: [number, number][] | number[][] | string | null;
}

/**
 * Determina si el punto (lat, lon) se encuentra dentro de un polígono 2D
 * utilizando el algoritmo Ray-Casting (conteo de intersecciones de rayos).
 *
 * @param lat Latitud del punto a evaluar.
 * @param lon Longitud del punto a evaluar.
 * @param poligono Arreglo de coordenadas [[lat, lon], ...] que definen los vértices del polígono.
 * @returns true si el punto está dentro del polígono, false en caso contrario.
 */
export function puntoEnPoligono(
  lat: number,
  lon: number,
  poligono: [number, number][] | number[][]
): boolean {
  const n = poligono.length;
  if (n < 3) {
    return true;
  }

  let dentro = false;
  let p1_lat = Number(poligono[0][0]);
  let p1_lon = Number(poligono[0][1]);

  for (let i = 1; i <= n; i++) {
    const p2 = poligono[i % n];
    const p2_lat = Number(p2[0]);
    const p2_lon = Number(p2[1]);

    if (Math.min(p1_lat, p2_lat) < lat && lat <= Math.max(p1_lat, p2_lat)) {
      if (p1_lat !== p2_lat) {
        const x_inters =
          ((lat - p1_lat) * (p2_lon - p1_lon)) / (p2_lat - p1_lat) + p1_lon;
        if (lon <= x_inters) {
          dentro = !dentro;
        }
      }
    }
    p1_lat = p2_lat;
    p1_lon = p2_lon;
  }

  return dentro;
}

/**
 * Calcula la distancia geodésica en metros entre dos coordenadas (Haversine).
 *
 * @param lat1 Latitud del punto 1 en grados decimales.
 * @param lon1 Longitud del punto 1 en grados decimales.
 * @param lat2 Latitud del punto 2 en grados decimales.
 * @param lon2 Longitud del punto 2 en grados decimales.
 * @returns Distancia en metros sobre la esfera terrestre.
 */
export function calcularHaversineM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const r_tierra = 6371000.0; // Radio medio terrestre en metros
  const toRad = (deg: number) => (deg * Math.PI) / 180.0;

  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const delta_phi = toRad(lat2 - lat1);
  const delta_lambda = toRad(lon2 - lon1);

  const a =
    Math.sin(delta_phi / 2.0) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(delta_lambda / 2.0) ** 2;
  const c = 2.0 * Math.atan2(Math.sqrt(a), Math.sqrt(1.0 - a));
  return r_tierra * c;
}

/**
 * Función pura de validación espacial de la posición del ancla/muerto respecto a la línea:
 * 1. Si latitud == null o longitud == null o no hay geometría en linea -> retorna true.
 * 2. Si linea.zona_designada (parseada como array de [lat, lon]) tiene >= 3 vértices -> Ray-Casting.
 * 3. Si no hay polígono pero existen lat_muerto y lon_muerto -> distancia Haversine <= (radio_tolerancia_m ?? 50.0).
 * 4. Si la línea no tiene geometría configurada -> retorna true.
 *
 * @param linea Objeto de línea con información de zona designada o coordenadas de ancla/muerto.
 * @param latitud Coordenada de latitud del registro capturado.
 * @param longitud Coordenada de longitud del registro capturado.
 * @returns true si el punto cae dentro de la zona tolerada o no hay restricciones geográficas.
 */
export function evaluarDentroZona(
  linea: LineaGeometria | null | undefined,
  latitud: number | null | undefined,
  longitud: number | null | undefined
): boolean {
  if (latitud == null || longitud == null || isNaN(latitud) || isNaN(longitud)) {
    return true;
  }
  if (!linea) {
    return true;
  }

  // 1. Polígono zona designada
  let zona: unknown = linea.zona_designada;
  if (typeof zona === 'string') {
    try {
      zona = JSON.parse(zona);
    } catch {
      zona = null;
    }
  }

  if (Array.isArray(zona) && zona.length >= 3) {
    try {
      return puntoEnPoligono(latitud, longitud, zona as [number, number][]);
    } catch {
      // Si la estructura no es válida, continuar con la siguiente regla
    }
  }

  // 2. Radio de tolerancia respecto a la posición objetivo del muerto/ancla
  const lat_m = linea.lat_muerto;
  const lon_m = linea.lon_muerto;
  if (
    lat_m !== null &&
    lat_m !== undefined &&
    lon_m !== null &&
    lon_m !== undefined &&
    !isNaN(Number(lat_m)) &&
    !isNaN(Number(lon_m))
  ) {
    try {
      const dist = calcularHaversineM(
        latitud,
        longitud,
        Number(lat_m),
        Number(lon_m)
      );
      const tolerancia = Number(linea.radio_tolerancia_m ?? 50.0);
      return dist <= tolerancia;
    } catch {
      // Ignorar fallo numérico y retornar true
    }
  }

  // 3. Sin geometría configurada
  return true;
}
