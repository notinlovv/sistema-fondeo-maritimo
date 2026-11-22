import * as SQLite from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * Nombre del archivo de base de datos local SQLite.
 */
export const DB_NAME = 'fondeo_local.db';

/**
 * Instancia de conexión síncrona moderna a SQLite (Expo SDK 52+).
 */
export const db: SQLiteDatabase = SQLite.openDatabaseSync(DB_NAME);

/**
 * Retorna la instancia de conexión activa a SQLite para ejecutar
 * consultas preparadas (`runAsync`, `getAllAsync`, `getFirstAsync`, etc.).
 */
export const getDB = (): SQLiteDatabase => {
  return db;
};

/**
 * Estados posibles de sincronización para un registro local.
 */
export type EstadoSync = 'pendiente' | 'sincronizado' | 'conflicto';

/**
 * Estados posibles del ítem en la cola de salida (Transactional Outbox).
 */
export type OutboxEstado = 'pendiente' | 'en_proceso' | 'fallido' | 'conflicto' | 'completado';

/**
 * Representación del registro de avance en la base de datos local.
 */
export interface RegistroLocal {
  id: string; // UUID v4 generado en el móvil
  linea_id: number;
  usuario_id: number;
  metros_avanzados: number;
  fecha: string; // ISO 8601 UTC
  latitud: number;
  longitud: number;
  estado: string; // Default: 'activa'
  observacion: string | null;
  estado_sync: EstadoSync; // Default: 'pendiente'
  creado_en: string;
  sincronizado_en?: string | null;
  version_esquema: number; // Default: 1
  dentro_zona?: number | boolean | null; // 1: dentro de zona, 0: fuera de zona
}

/**
 * Representación de una línea de fondeo almacenada en caché local para validación offline.
 */
export interface LineaCache {
  id: number;
  nombre: string;
  estado?: string | null;
  metros_totales?: number | null;
  lat_inicio?: number | null;
  lon_inicio?: number | null;
  lat_muerto?: number | null;
  lon_muerto?: number | null;
  radio_tolerancia_m?: number | null;
  zona_designada?: string | null; // JSON serializado de vértices [[lat, lon], ...]
  actualizado_en?: string | null; // ISO 8601 UTC
}

/**
 * Metadato del motor de sincronización (cursores de pull, timestamps, etc.).
 */
export interface SyncMeta {
  clave: string;
  valor: string;
}

/**
 * Representación de una tarea pendiente en la cola de salida asíncrona (Transactional Outbox).
 */
export interface OutboxItem {
  id: number; // Autoincremental
  uuid: string; // Referencia al UUID del registro
  metodo: string; // Default: 'PUT'
  endpoint: string; // ej: '/registros/{uuid}'
  payload: string; // JSON serializado con los datos del registro
  estado: OutboxEstado; // Default: 'pendiente'
  reintentos: number; // Default: 0
  creado_en: string; // ISO 8601 UTC
  ultimo_error: string | null;
}

/**
 * Tipo auxiliar para la inserción de nuevos registros locales.
 */
export type NuevoRegistroLocal = Omit<RegistroLocal, 'version_esquema' | 'creado_en' | 'sincronizado_en'> & {
  version_esquema?: number;
  creado_en?: string;
  sincronizado_en?: string | null;
  dentro_zona?: number | null;
};

/**
 * Tipo auxiliar para la inserción de nuevos ítems en la cola de salida.
 */
export type NuevoOutboxItem = Omit<OutboxItem, 'id' | 'reintentos' | 'ultimo_error'> & {
  id?: number;
  reintentos?: number;
  ultimo_error?: string | null;
};

/**
 * Inicializa la base de datos local de manera idempotente creando las tablas
 * e índices requeridos si no existen y aplicando migraciones seguras sin pérdida de datos.
 */
export const initDB = (): void => {
  try {
    // Configuración inicial de rendimiento y restricciones
    db.execSync(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
    `);

    // Migración preventiva: si la tabla outbox existía con el esquema preliminar
    // anterior (sin columna 'uuid'), se reemplaza por el esquema definitivo.
    const tableInfo = db.getAllSync<{ name: string }>('PRAGMA table_info(outbox);');
    const hasUuid = tableInfo.some((col) => col.name === 'uuid');
    if (tableInfo.length > 0 && !hasUuid) {
      db.execSync('DROP TABLE IF EXISTS outbox;');
    }

    // Creación de tablas e índices principales de la arquitectura offline-first
    db.execSync(`
      CREATE TABLE IF NOT EXISTS registros_locales (
        id TEXT PRIMARY KEY,
        linea_id INTEGER NOT NULL,
        usuario_id INTEGER NOT NULL,
        metros_avanzados REAL NOT NULL,
        fecha TEXT NOT NULL,
        latitud REAL NOT NULL,
        longitud REAL NOT NULL,
        estado TEXT DEFAULT 'activa',
        observacion TEXT,
        estado_sync TEXT DEFAULT 'pendiente',
        creado_en TEXT NOT NULL,
        sincronizado_en TEXT,
        version_esquema INTEGER DEFAULT 1,
        dentro_zona INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS lineas_cache (
        id INTEGER PRIMARY KEY,
        nombre TEXT NOT NULL,
        estado TEXT,
        metros_totales REAL,
        lat_inicio REAL,
        lon_inicio REAL,
        lat_muerto REAL,
        lon_muerto REAL,
        radio_tolerancia_m REAL DEFAULT 50.0,
        zona_designada TEXT,
        actualizado_en TEXT
      );

      CREATE TABLE IF NOT EXISTS sync_meta (
        clave TEXT PRIMARY KEY,
        valor TEXT
      );

      CREATE TABLE IF NOT EXISTS outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT NOT NULL,
        metodo TEXT DEFAULT 'PUT',
        endpoint TEXT NOT NULL,
        payload TEXT NOT NULL,
        estado TEXT DEFAULT 'pendiente',
        reintentos INTEGER DEFAULT 0,
        creado_en TEXT NOT NULL,
        ultimo_error TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_outbox_estado_creado_en ON outbox (estado, creado_en);
      CREATE INDEX IF NOT EXISTS idx_outbox_uuid ON outbox (uuid);
      CREATE INDEX IF NOT EXISTS idx_registros_locales_linea_fecha ON registros_locales (linea_id, fecha);
      CREATE INDEX IF NOT EXISTS idx_lineas_cache_id ON lineas_cache (id);

      -- Tabla auxiliar para compatibilidad con pantallas prototipo anteriores
      CREATE TABLE IF NOT EXISTS registros_avance (
        id TEXT PRIMARY KEY,
        linea_id INTEGER NOT NULL,
        metros_avanzados REAL NOT NULL,
        fecha TEXT NOT NULL,
        latitud REAL,
        longitud REAL,
        estado TEXT DEFAULT 'pendiente',
        observacion TEXT,
        estado_sync TEXT DEFAULT 'pendiente'
      );
    `);

    // Migración idempotente para asegurar columna 'dentro_zona' en instalaciones preexistentes
    try {
      db.execSync('ALTER TABLE registros_locales ADD COLUMN dentro_zona INTEGER DEFAULT 1;');
    } catch {
      // Ignorar error si la columna ya existe en registros_locales
    }

    console.log('Base de datos local SQLite inicializada exitosamente');
  } catch (error) {
    console.error('Error al inicializar la base de datos local SQLite:', error);
    throw error;
  }
};

/**
 * Guarda o actualiza un arreglo de líneas de fondeo en la tabla local lineas_cache.
 */
export const guardarLineasCache = async (lineas: LineaCache[]): Promise<void> => {
  if (!lineas || lineas.length === 0) return;
  const database = getDB();
  await database.withTransactionAsync(async () => {
    for (const l of lineas) {
      await database.runAsync(
        `INSERT OR REPLACE INTO lineas_cache (
          id,
          nombre,
          estado,
          metros_totales,
          lat_inicio,
          lon_inicio,
          lat_muerto,
          lon_muerto,
          radio_tolerancia_m,
          zona_designada,
          actualizado_en
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          l.id,
          l.nombre,
          l.estado ?? null,
          l.metros_totales ?? null,
          l.lat_inicio ?? null,
          l.lon_inicio ?? null,
          l.lat_muerto ?? null,
          l.lon_muerto ?? null,
          l.radio_tolerancia_m ?? 50.0,
          l.zona_designada ?? null,
          l.actualizado_en ?? new Date().toISOString(),
        ]
      );
    }
  });
};

/**
 * Obtiene todas las líneas de fondeo cacheadas localmente.
 */
export const obtenerLineasCache = async (): Promise<LineaCache[]> => {
  const database = getDB();
  return await database.getAllAsync<LineaCache>(
    'SELECT * FROM lineas_cache ORDER BY id ASC'
  );
};

/**
 * Obtiene una línea de fondeo de la caché local por su ID.
 */
export const obtenerLineaCachePorId = async (id: number): Promise<LineaCache | null> => {
  const database = getDB();
  return await database.getFirstAsync<LineaCache>(
    'SELECT * FROM lineas_cache WHERE id = ?',
    [id]
  );
};

/**
 * Obtiene el último error registrado en el outbox para un UUID específico.
 */
export const obtenerUltimoErrorOutbox = async (uuid: string): Promise<string | null> => {
  const database = getDB();
  const row = await database.getFirstAsync<{ ultimo_error: string | null }>(
    'SELECT ultimo_error FROM outbox WHERE uuid = ? ORDER BY id DESC LIMIT 1',
    [uuid]
  );
  return row?.ultimo_error ?? null;
};

/**
 * Obtiene el valor de una clave en sync_meta (ej: 'ultima_sincronizacion_pull').
 */
export const obtenerMetaSync = async (clave: string): Promise<string | null> => {
  const database = getDB();
  const row = await database.getFirstAsync<{ valor: string }>(
    'SELECT valor FROM sync_meta WHERE clave = ?',
    [clave]
  );
  return row?.valor ?? null;
};

/**
 * Guarda o actualiza un valor de metadato en sync_meta.
 */
export const guardarMetaSync = async (clave: string, valor: string): Promise<void> => {
  const database = getDB();
  await database.runAsync(
    'INSERT OR REPLACE INTO sync_meta (clave, valor) VALUES (?, ?)',
    [clave, valor]
  );
};

export default db;
