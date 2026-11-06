import { z } from 'zod';

/**
 * Esquema de validación Zod para la captura de avance en terreno.
 */
export const registroSchema = z.object({
  linea_id: z
    .number({ message: 'La línea de fondeo es obligatoria' })
    .int('La línea de fondeo debe ser un número entero')
    .positive('Debe seleccionar una línea de fondeo válida'),
  metros_avanzados: z
    .number({ message: 'Los metros avanzados son obligatorios' })
    .positive('Los metros avanzados deben ser mayores a 0'),
  latitud: z.number({ message: 'La coordenada de latitud es obligatoria' }),
  longitud: z.number({ message: 'La coordenada de longitud es obligatoria' }),
  observacion: z
    .string()
    .max(500, 'La observación no puede superar los 500 caracteres')
    .nullable()
    .optional(),
});

/**
 * Tipo inferido de TypeScript a partir del esquema de validación.
 */
export type RegistroFormData = z.infer<typeof registroSchema>;
