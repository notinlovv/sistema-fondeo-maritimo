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
export type OutboxEstado = 'pendiente' | 'en_proceso' | 'fallido';

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
  sincronizado_en: string | null;
  version_esquema: number; // Default: 1
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
 * e índices requeridos si no existen.
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
        version_esquema INTEGER DEFAULT 1
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
      CREATE INDEX IF NOT EXISTS idx_registros_locales_linea_fecha ON registros_locales (linea_id, fecha);

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

    console.log('Base de datos local SQLite inicializada exitosamente');
  } catch (error) {
    console.error('Error al inicializar la base de datos local SQLite:', error);
    throw error;
  }
};

export default db;
