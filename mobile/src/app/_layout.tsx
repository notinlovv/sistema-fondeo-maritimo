import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { initDB } from '../db/database';
import { iniciarObservadorRed } from '../sync/syncManager';

export default function RootLayout() {
  useEffect(() => {
    // Inicializar las tablas locales SQLite al arrancar la aplicación
    try {
      initDB();
    } catch (error) {
      console.error("Error inicializando la BD local:", error);
    }

    // Iniciar escucha reactiva de red para vaciar la cola Outbox automáticamente
    const unsubscribe = iniciarObservadorRed();

    return () => {
      unsubscribe();
    };
  }, []);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen 
        name="index" 
        options={{ 
          title: 'Inicio',
          headerShown: false
        }} 
      />
      <Stack.Screen 
        name="explore" 
        options={{ 
          title: 'Captura en Terreno',
          headerShown: false,
          headerBackVisible: false,
          gestureEnabled: false
        }} 
      />
    </Stack>
  );
}