# TFMPlayer

Reproductor de música (PWA) para **[TelegramFileManager](https://github.com/mateof/TelegramFileManager)**:
escucha el audio de tus canales de Telegram y de la carpeta local del servidor desde el
móvil o el escritorio, con descargas offline, playlists y ecualizador.

Publicado en GitHub Pages: `https://mateof.github.io/TFMPlayer/` (se instala como app
desde el navegador).

## Funciones

- **Canales y ficheros locales** con carpetas, búsqueda, filtros por formato y listas
  virtualizadas (miles de ficheros sin tirones). Selección múltiple (pulsación larga,
  Ctrl+clic o Espacio) para añadir carpetas enteras a una playlist, descargarlas o
  ponerlas a continuación.
- **Refrescar un canal** desde la app: el servidor indexa los ficheros nuevos de
  Telegram (el audio siempre; vídeo, documentos y fotos a elegir).
- **Búsqueda global** en todos los canales y en los ficheros locales.
- **Playlists** del servidor, guardables offline, y **playlists inteligentes** por
  reglas (canales, formatos, texto, fecha de alta, orden y límite).
- **Historial**: escuchadas recientemente y más escuchadas.
- **Reproducción continua con la pantalla apagada**: dos elementos de audio alternos,
  la siguiente pista se precarga y arranca antes de soltar la actual (sin silencios
  entre canciones). Fundido (crossfade) opcional y temporizador de apagado.
- **La cola sobrevive** a cerrar la app (pista y posición incluidas).
- **Offline**: descargas en el dispositivo (con conversión a MP3/AAC opcional en el
  servidor), datos de pantallas cacheados y **gestión de almacenamiento** con limpieza
  de lo que no se escucha.
- **Escritorio**: paneles (navegación, contenido, "sonando ahora"), reproductor
  maximizado a pantalla completa, arrastrar pistas o carpetas a una playlist, atajos de
  teclado y teclas multimedia.
- Ecualizador de 10 bandas, refuerzo de graves, amplitud estéreo y nivelación de volumen.
- Interfaz en **español** (por defecto) e inglés.

### Atajos de teclado

| Tecla | Acción |
| --- | --- |
| Espacio | Reproducir / pausa |
| ← / → | Retroceder / avanzar 10 s |
| Shift + ← / → | Pista anterior / siguiente |
| Esc | Cerrar el reproductor maximizado o un diálogo |
| ↑ / ↓, Inicio / Fin | Moverse por las listas |
| Enter | Reproducir / abrir |
| Alt + ↑ / ↓ | Reordenar pistas (playlist y cola) |

## Puesta en marcha

1. Ten **TelegramFileManager** en marcha y una clave de API móvil configurada
   (`mobile_api_key`). Para convertir descargas a MP3/AAC usa la imagen con FFmpeg
   (`dev_latest`, no `-lite`).
2. Abre la PWA, indica host, puerto, HTTPS y clave de API.

Algunas funciones dependen de la versión del servidor; la app pregunta qué soporta
(`GET /api/mobile/capabilities`) y, si no lo sabe, usa el camino antiguo:

| Función | Sin soporte en el servidor |
| --- | --- |
| Añadir muchas pistas a una playlist de golpe | Se añaden de una en una |
| Búsqueda global | Se buscan solo los canales favoritos |
| Refrescar canal / estadísticas | El botón avisa de que hay que actualizar el servidor |

## Desarrollo

Requisitos: Node 22+.

```bash
npm install
npm run dev      # servidor de desarrollo (http://localhost:5173/TFMPlayer/)
npm test         # tests (Vitest + Testing Library + fake-indexeddb)
npm run lint
npm run build    # comprueba tipos y genera dist/
```

Cada push a `main` ejecuta tests y build y despliega en GitHub Pages
(`.github/workflows/deploy.yml`). La versión que se ve en Ajustes sale de `package.json`.

### Estructura

- `src/services/audio/AudioPlayerService.ts`: motor de reproducción (dos elementos de
  audio, precarga, crossfade, Media Session, temporizador, recuperación de errores).
- `src/components/files/FileBrowser.tsx`: navegador de ficheros compartido por canales
  y ficheros locales.
- `src/services/query/queryClient.ts`: react-query persistido en IndexedDB (las
  pantallas se ven al instante y sin conexión).
- `src/db/database.ts`: IndexedDB (Dexie): descargas, cola de descargas, historial,
  playlists offline e inteligentes.
- `src/i18n/`: traducciones. El texto en inglés es la clave (`t('Play all')`); el
  español está en `src/i18n/es/*.ts`. Un test falla si algún texto no tiene traducción.

### Depuración

En Ajustes → Avanzado se activan los **logs de depuración**. Para la reproducción con
la pantalla apagada en Android: `chrome://inspect` por USB con la PWA instalada.

## Licencia

Ver [LICENSE](LICENSE).
