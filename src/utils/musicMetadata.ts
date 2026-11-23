// music-metadata (and its per-format parsers) is big and only needed once a
// file has to be analysed: load it on first use, outside the startup bundle
let modulePromise: Promise<typeof import('music-metadata')> | null = null;

export function loadMusicMetadata(): Promise<typeof import('music-metadata')> {
  if (!modulePromise) {
    modulePromise = import('music-metadata').catch((error) => {
      modulePromise = null; // allow a retry (e.g. chunk failed to load offline)
      throw error;
    });
  }
  return modulePromise;
}
