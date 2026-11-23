// Player (overlay, mini player, desktop bar, queue, sleep timer, visualizer) and track lists
const player: Record<string, string> = {
  // Transport and controls
  'Play': 'Reproducir',
  'Pause': 'Pausar',
  'Play/Pause (Space)': 'Reproducir/Pausar (Espacio)',
  'Next track': 'Pista siguiente',
  'Previous track': 'Pista anterior',
  'Next (Shift+→)': 'Siguiente (Mayús+→)',
  'Previous (Shift+←)': 'Anterior (Mayús+←)',
  'Back {count} seconds': 'Retroceder {count} segundos',
  'Forward {count} seconds': 'Avanzar {count} segundos',
  'Seek': 'Posición',
  'Mute': 'Silenciar',
  'Unmute': 'Activar sonido',
  'Volume': 'Volumen',
  'Repeat: {mode}': 'Repetir: {mode}',
  'Off': 'No',
  'All tracks': 'Todas las pistas',
  'This track': 'Esta pista',

  // Overlay / panels
  'Now playing': 'Sonando ahora',
  'Now playing panel': 'Panel Sonando ahora',
  'Player': 'Reproductor',
  'Player panels': 'Paneles del reproductor',
  'Minimize player (Esc)': 'Minimizar reproductor (Esc)',
  'Open full player': 'Abrir reproductor completo',
  'Full player (equalizer, queue)': 'Reproductor completo (ecualizador, cola)',
  'Hide panel': 'Ocultar panel',
  'Toggle equalizer': 'Mostrar/ocultar ecualizador',
  'Up next': 'A continuación',
  'Details': 'Detalles',
  'Visualizer': 'Visualizador',
  'Cover': 'Carátula',
  'Unknown artist': 'Artista desconocido',
  '{n} of {total}': '{n} de {total}',
  'No track playing': 'No se está reproduciendo nada',
  'Go back': 'Volver',
  'Tap for details': 'Toca para ver detalles',
  'Tap for visualizer': 'Toca para ver el visualizador',

  // Track metadata
  'Track info': 'Información de la pista',
  'Loading metadata...': 'Cargando metadatos...',
  'No metadata available': 'No hay metadatos disponibles',
  'Tags': 'Etiquetas',
  'Technical': 'Datos técnicos',
  'Title': 'Título',
  'Artist': 'Artista',
  'Album': 'Álbum',
  'Year': 'Año',
  'Genre': 'Género',
  'Track': 'Pista',
  'Format': 'Formato',
  'Codec': 'Códec',
  'Bitrate': 'Tasa de bits',
  'Sample rate': 'Frecuencia de muestreo',
  'Channels': 'Canales',
  'Stereo': 'Estéreo',
  'Mono': 'Mono',
  'Bit depth': 'Profundidad de bits',
  'Duration': 'Duración',
  'Size': 'Tamaño',
  'File': 'Fichero',
  'Source': 'Origen',
  'Channel': 'Canal',
  'Server local files': 'Ficheros locales del servidor',
  'Offline': 'Sin conexión',
  'Stored on device': 'Guardada en el dispositivo',
  'Streaming': 'En streaming',
  'on device': 'en el dispositivo',

  // Queue
  'Queue': 'Cola',
  'Close queue': 'Cerrar cola',
  '+{count} more': '+{count} más',
  'Queue: {count} tracks. Alt+arrows reorder.': 'Cola: {count} pistas. Alt+flechas para reordenar.',
  'Remove {name} from the queue': 'Quitar {name} de la cola',
  'Remove from queue': 'Quitar de la cola',
  'Loading more...': 'Cargando más...',
  'Scroll down to load more from {name}': 'Desplázate hacia abajo para cargar más de {name}',

  // Sleep timer
  'Sleep timer': 'Temporizador',
  'Sleep timer: {time}': 'Temporizador: {time}',
  'end of track': 'fin de la pista',
  'End': 'Fin',
  'Stop playing in': 'Detener en',
  '{count} minutes': '{count} minutos',
  'End of this track': 'Al acabar esta pista',
  'Turn off': 'Desactivar',

  // Visualizer modes
  'Bars': 'Barras',
  'Mirror': 'Espejo',
  'Wave': 'Onda',
  'Circle': 'Círculo',

  // Track list
  'Nothing here yet': 'Aún no hay nada aquí',

  // Playback errors
  'Playback error': 'Error de reproducción',
  'Failed to play track': 'No se pudo reproducir la pista'
};

export default player;
