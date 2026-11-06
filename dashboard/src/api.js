import axios from 'axios';

// Utiliza la URL de la variable de entorno, o por defecto localhost:8000
const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';

export const api = axios.create({
  baseURL: API_URL,
  timeout: 8000,
});

// Interceptor para agregar el token JWT a todas las peticiones si existe
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/**
 * Consulta el resumen ejecutivo gerencial del dashboard.
 * Envía el header Authorization con el token JWT si está disponible.
 * Si se omite lineaId, el backend selecciona la línea activa por defecto.
 *
 * @param {number|string} [lineaId] - ID opcional de la línea de fondeo.
 * @returns {Promise<object>} Objeto con KPIs, proyecciones, alertas y serie temporal.
 */
export const obtenerResumenDashboard = async (lineaId) => {
  const token = localStorage.getItem('token');
  const headers = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const params = {};
  if (lineaId !== undefined && lineaId !== null && lineaId !== '') {
    params.linea_id = lineaId;
  }

  const response = await api.get('/dashboard/resumen', {
    params,
    headers,
  });
  return response.data;
};

/**
 * Obtiene el listado de todas las líneas de fondeo registradas en el sistema.
 *
 * @returns {Promise<Array>} Lista de líneas de fondeo con sus metadatos.
 */
export const obtenerLineas = async () => {
  const token = localStorage.getItem('token');
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  const response = await api.get('/lineas/', { headers });
  return response.data;
};

/**
 * Descarga el informe consolidado de avance en formato Excel (.xlsx).
 *
 * @param {number|string} lineaId - ID de la línea de fondeo.
 * @returns {Promise<Blob>} Archivo binario para descarga.
 */
export const descargarReporteExcel = async (lineaId) => {
  const token = localStorage.getItem('token');
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const params = lineaId ? { linea_id: lineaId } : {};

  const response = await api.get('/reportes/avance.xlsx', {
    params,
    headers,
    responseType: 'blob',
  });
  return response.data;
};

export default api;
