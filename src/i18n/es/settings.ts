// Settings, setup, downloads, storage and related services
const settings: Record<string, string> = {
  // SettingsPage
  'FFmpeg is not installed on the server. Downloads will keep the original format.':
    'FFmpeg no está instalado en el servidor. Las descargas mantendrán el formato original.',
  'The server does not support transcoding. Update TelegramFileManager.':
    'El servidor no admite la conversión. Actualiza TelegramFileManager.',
  'Please fill in all required fields': 'Rellena todos los campos obligatorios',
  'Connection failed. Check your settings.': 'Error de conexión. Revisa los ajustes.',
  'Settings saved!': '¡Ajustes guardados!',
  'Failed to save settings': 'No se pudieron guardar los ajustes',
  'Removed {count} auto-cached tracks to fit the new limit':
    'Se han quitado {count} pistas de la caché automática para ajustarse al nuevo límite',
  'Delete all downloads?': '¿Eliminar todas las descargas?',
  'Every track stored on this device will be removed. This cannot be undone.':
    'Se eliminarán todas las pistas guardadas en este dispositivo. No se puede deshacer.',
  'Cache cleared': 'Caché vaciada',
  'Failed to clear cache': 'No se pudo vaciar la caché',
  'Disconnect from the server?': '¿Desconectar del servidor?',
  'Downloads and cached data are kept on this device.':
    'Las descargas y los datos en caché se conservan en este dispositivo.',
  'Disconnect': 'Desconectar',
  'Failed to disconnect': 'No se pudo desconectar',
  'Server Connection': 'Conexión con el servidor',
  'Server Host': 'Servidor',
  'Port': 'Puerto',
  'API Key': 'Clave de API',
  'Enter API key': 'Introduce la clave de API',
  'Use HTTPS': 'Usar HTTPS',
  'Save Connection Settings': 'Guardar ajustes de conexión',
  'Storage': 'Almacenamiento',
  'Cached Audio': 'Audio en caché',
  'Cache songs while streaming': 'Guardar en caché al reproducir en streaming',
  'Reuse downloaded audio when seeking or replaying':
    'Reutiliza el audio descargado al avanzar o volver a reproducir',
  'Cache size limit': 'Límite de la caché',
  'Oldest auto-cached songs are removed first. Downloads are kept.':
    'Se quitan primero las canciones más antiguas de la caché automática. Las descargas se conservan.',
  'Unlimited': 'Sin límite',
  'Download format': 'Formato de descarga',
  'Convert offline downloads (e.g. FLAC) to save space':
    'Convierte las descargas sin conexión (p. ej. FLAC) para ahorrar espacio',
  'Original': 'Original',
  'FFmpeg is not available on the server, so transcoding is disabled. Install FFmpeg on the TelegramFileManager host to enable it.':
    'FFmpeg no está disponible en el servidor, así que la conversión está desactivada. Instala FFmpeg en el equipo de TelegramFileManager para activarla.',
  'Player': 'Reproductor',
  'Skip buttons': 'Botones de salto',
  'Jump backward/forward buttons in the expanded player':
    'Botones para retroceder/avanzar en el reproductor ampliado',
  'Backward': 'Retroceder',
  'Forward': 'Avanzar',
  '{count} seconds': '{count} segundos',
  'Sound': 'Sonido',
  'Sound enhancement': 'Mejora de sonido',
  'Equalizer, bass boost, 3D stereo and volume leveling':
    'Ecualizador, refuerzo de graves, estéreo 3D y nivelación de volumen',
  'Equalizer preset': 'Preajuste del ecualizador',
  'Custom': 'Personalizado',
  'Bass boost': 'Refuerzo de graves',
  '3D stereo width': 'Amplitud estéreo 3D',
  'Volume leveling': 'Nivelación de volumen',
  'Evens out loudness differences between tracks':
    'Iguala las diferencias de volumen entre pistas',
  'About': 'Acerca de',
  'Version {version}': 'Versión {version}',
  'Build: {build}': 'Compilación: {build}',
  'Danger Zone': 'Zona de peligro',
  'Disconnect from Server': 'Desconectar del servidor',

  // EQ presets (eqPresets.ts labels)
  'Flat': 'Plano',
  'Rock': 'Rock',
  'Pop': 'Pop',
  'Jazz': 'Jazz',
  'Classical': 'Clásica',
  'Electronic': 'Electrónica',
  'Bass Boost': 'Refuerzo de graves',
  'Vocal': 'Voces',

  // ExtraSettings
  'Transitions': 'Transiciones',
  'Crossfade': 'Fundido',
  'The next track fades in over the last {count} seconds':
    'La siguiente pista entra con un fundido en los últimos {count} segundos',
  'Off: tracks follow each other without a gap': 'Desactivado: las pistas se suceden sin pausa',
  'Crossfade seconds': 'Segundos de fundido',
  'Library': 'Biblioteca',
  'Automatic clean-up: not played in {count} days': 'Limpieza automática: sin reproducir en {count} días',
  'Space used per channel, free up space': 'Espacio usado por canal, liberar espacio',
  'Recently played and most played': 'Escuchadas recientemente y más escuchadas',
  'Language': 'Idioma',
  'App language': 'Idioma de la aplicación',
  'Advanced': 'Avanzado',
  'Debug logging': 'Registro de depuración',
  'Detailed console messages to diagnose playback problems':
    'Mensajes detallados en la consola para diagnosticar problemas de reproducción',

  // SetupPage
  'Connection successful!': '¡Conexión correcta!',
  'Please test the connection first': 'Prueba primero la conexión',
  'Configuration saved!': '¡Configuración guardada!',
  'Failed to save configuration': 'No se pudo guardar la configuración',
  'Configure your server connection': 'Configura la conexión con tu servidor',
  '192.168.1.100 or example.com': '192.168.1.100 o ejemplo.com',
  'Enter your API key': 'Introduce tu clave de API',
  'Enable secure connection': 'Activa la conexión segura',
  'Connection successful': 'Conexión correcta',
  'Connection failed': 'Error de conexión',
  'Test Connection': 'Probar conexión',
  'Save & Continue': 'Guardar y continuar',

  // DownloadsPage
  'Re-download in {format}?': '¿Volver a descargar en {format}?',
  '{count} track(s) will be downloaded again. The current copies stay available until each new one arrives.':
    'Se volverán a descargar {count} pista(s). Las copias actuales siguen disponibles hasta que llegue cada nueva.',
  'Re-download': 'Volver a descargar',
  '{count} track(s) queued for re-download': '{count} pista(s) en cola para volver a descargarse',
  'Remove "{name}" from this device?': '¿Quitar «{name}» de este dispositivo?',
  'Cancel all downloads?': '¿Cancelar todas las descargas?',
  'Cancel downloads': 'Cancelar descargas',
  'Clear all failed downloads?': '¿Vaciar todas las descargas fallidas?',
  'Clear the download queue?': '¿Vaciar la cola de descargas?',
  'This removes all pending, failed and completed items.':
    'Se quitarán todos los elementos pendientes, fallidos y completados.',
  '"{name}" will play next': '«{name}» sonará a continuación',
  'Queue ({count})': 'Cola ({count})',
  'Cached ({count})': 'En caché ({count})',
  'Cache Size': 'Tamaño de la caché',
  'Analyze ({count})': 'Analizar ({count})',
  'Clear All': 'Vaciar todo',
  '{count} track(s) are not in {format}': '{count} pista(s) no están en {format}',
  'Analyzing metadata... {current}/{total}': 'Analizando metadatos... {current}/{total}',
  'No active downloads': 'No hay descargas activas',
  'Clear Queue': 'Vaciar cola',
  'Restart Queue': 'Reiniciar cola',
  'Cancel All ({count})': 'Cancelar todo ({count})',
  'Failed ({count})': 'Fallidas ({count})',
  'Clear Failed': 'Vaciar fallidas',
  'Download failed': 'Error en la descarga',
  'No cached tracks': 'No hay pistas en caché',
  'Download tracks for offline listening': 'Descarga pistas para escucharlas sin conexión',
  'Cover': 'Carátula',

  // StoragePage
  'Delete the downloads of {name}?': '¿Eliminar las descargas de {name}?',
  '{count} track(s) of playlists kept offline are kept.':
    'Se conservan {count} pista(s) de playlists guardadas sin conexión.',
  'They can be downloaded again at any time.': 'Se pueden volver a descargar en cualquier momento.',
  '{count} track(s) deleted': '{count} pista(s) eliminada(s)',
  'Free up space?': '¿Liberar espacio?',
  'Tracks not played in {days} days are deleted, except those of playlists kept offline.':
    'Se eliminan las pistas no reproducidas en {days} días, salvo las de playlists guardadas sin conexión.',
  'Clean': 'Limpiar',
  '{count} track(s) deleted, {size} freed': '{count} pista(s) eliminada(s), {size} liberados',
  'Nothing to clean': 'No hay nada que limpiar',
  'Downloads on this device': 'Descargas en este dispositivo',
  '{count} tracks · {size}': '{count} pistas · {size}',
  '{used} used of {quota} available to the app': '{used} usados de {quota} disponibles para la aplicación',
  'Storage used': 'Almacenamiento usado',
  'Protected from automatic browser cleanup': 'Protegido frente a la limpieza automática del navegador',
  'The browser may delete downloads if space runs low':
    'El navegador puede borrar las descargas si queda poco espacio',
  '{count} offline playlist(s), {tracks} tracks protected':
    '{count} playlist(s) sin conexión, {tracks} pistas protegidas',
  'Free up space': 'Liberar espacio',
  'Delete what has not been played for a while. Playlists kept offline are never touched.':
    'Elimina lo que no se ha reproducido desde hace tiempo. Las playlists guardadas sin conexión nunca se tocan.',
  'Not played in': 'Sin reproducir en',
  '{count} days': '{count} días',
  'Clean now': 'Limpiar ahora',
  'Automatically at startup ({count} days)': 'Automáticamente al iniciar ({count} días)',
  'Do it automatically at startup': 'Hacerlo automáticamente al iniciar',
  'By source': 'Por origen',
  'Nothing downloaded yet.': 'Aún no hay nada descargado.',
  '{count} protected': '{count} protegidas',
  'Delete the downloads of {name}': 'Eliminar las descargas de {name}',

  // DownloadManager
  'the server has no FFmpeg': 'el servidor no tiene FFmpeg',
  'the server does not support it for this source': 'el servidor no lo admite para este origen',
  'the server answered {status}': 'el servidor respondió {status}',
  'Downloading in original format: transcoding failed because {reason}':
    'Descargando en el formato original: la conversión falló porque {reason}',
  'Unknown error': 'Error desconocido',

  // format.ts
  '{count} days ago': 'hace {count} días',
  '1 day ago': 'hace 1 día',
  '{count} hours ago': 'hace {count} horas',
  '1 hour ago': 'hace 1 hora',
  '{count} minutes ago': 'hace {count} minutos',
  '1 minute ago': 'hace 1 minuto',
  'Just now': 'Ahora mismo',
  'Unknown': 'Desconocido'
};

export default settings;
