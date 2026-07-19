import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Server, Key, Lock, Unlock, Trash2, HardDrive, Info, Zap, Music2 } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { db, getServerConfig, saveServerConfig, clearServerConfig } from '@/db/database';
import { apiClient } from '@/services/api/client';
import { cacheService } from '@/services/cache/CacheService';
import { audioPlayer } from '@/services/audio/AudioPlayerService';
import { streamApi } from '@/services/api/stream.api';
import { useSettingsStore, type SoundEnhancementSettings } from '@/stores/settingsStore';
import { EQ_BAND_LABELS, EQ_PRESETS } from '@/utils/eqPresets';
import { useUiStore } from '@/stores/uiStore';
import { formatFileSize } from '@/utils/format';
import { APP_CONFIG } from '@/config/app';

export function SettingsPage() {
  const navigate = useNavigate();
  const {
    clearSettings,
    autoCacheEnabled,
    maxCacheSizeMB,
    setAutoCacheEnabled,
    setMaxCacheSizeMB,
    sound,
    setSound,
    downloadFormat,
    downloadBitrate,
    setDownloadFormat,
    setDownloadBitrate
  } = useSettingsStore();

  const [transcodeUnavailable, setTranscodeUnavailable] = useState(false);

  // Selecting MP3/AAC requires FFmpeg on the server: verify before accepting
  const handleDownloadFormatChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const format = e.target.value as 'original' | 'mp3' | 'aac';
    if (format === 'original') {
      setDownloadFormat(format);
      setTranscodeUnavailable(false);
      return;
    }

    try {
      const info = await streamApi.getTranscodeInfo();
      if (!info.ffmpegAvailable) {
        setTranscodeUnavailable(true);
        addToast('FFmpeg is not installed on the server. Downloads will keep the original format.', 'warning');
        setDownloadFormat('original');
        return;
      }
    } catch {
      setTranscodeUnavailable(true);
      addToast('The server does not support transcoding. Update TelegramFileManager.', 'warning');
      setDownloadFormat('original');
      return;
    }

    setTranscodeUnavailable(false);
    setDownloadFormat(format);
    // Default bitrate per format if the current one doesn't apply
    if (format === 'aac' && downloadBitrate > 256) setDownloadBitrate(256);
  };

  // Update the store and apply the DSP settings live
  const updateSound = (partial: Partial<SoundEnhancementSettings>) => {
    setSound(partial);
    audioPlayer.applySoundSettings({ ...sound, ...partial });
  };

  const handleEqBandChange = (index: number, value: number) => {
    const eqGains = [...sound.eqGains];
    eqGains[index] = value;
    updateSound({ eqGains, preset: 'custom' });
  };
  const { addToast } = useUiStore();

  const [host, setHost] = useState('');
  const [port, setPort] = useState('5000');
  const [apiKey, setApiKey] = useState('');
  const [useHttps, setUseHttps] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cacheSize, setCacheSize] = useState(0);

  useEffect(() => {
    loadSettings();
    loadCacheSize();
  }, []);

  const loadSettings = async () => {
    const config = await getServerConfig();
    if (config) {
      setHost(config.host);
      setPort(config.port.toString());
      setApiKey(config.apiKey);
      setUseHttps(config.useHttps);
    }
  };

  const loadCacheSize = async () => {
    const tracks = await db.cachedTracks.toArray();
    setCacheSize(tracks.reduce((acc, t) => acc + t.fileSize, 0));
  };

  const handleSave = async () => {
    if (!host || !apiKey) {
      addToast('Please fill in all required fields', 'warning');
      return;
    }

    setSaving(true);
    try {
      const success = await apiClient.testConnection(host, parseInt(port), apiKey, useHttps);
      if (!success) {
        addToast('Connection failed. Check your settings.', 'error');
        return;
      }

      await saveServerConfig({
        host,
        port: parseInt(port),
        apiKey,
        useHttps
      });

      apiClient.clearCache();
      addToast('Settings saved!', 'success');
    } catch {
      addToast('Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleMaxCacheSizeChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const sizeMB = parseInt(e.target.value);
    setMaxCacheSizeMB(sizeMB);

    // Apply the new limit immediately (only auto-cached tracks are evicted)
    const removed = await cacheService.enforceCacheLimit(sizeMB * 1024 * 1024);
    if (removed > 0) {
      addToast(`Removed ${removed} auto-cached tracks to fit the new limit`, 'info');
      loadCacheSize();
    }
  };

  const handleClearCache = async () => {
    if (!confirm('Clear all cached tracks? This cannot be undone.')) return;

    try {
      await db.cachedTracks.clear();
      setCacheSize(0);
      addToast('Cache cleared', 'success');
    } catch {
      addToast('Failed to clear cache', 'error');
    }
  };

  const handleLogout = async () => {
    if (!confirm('Disconnect from server? All cached data will be kept.')) return;

    try {
      await clearServerConfig();
      clearSettings();
      apiClient.clearCache();
      navigate('/setup');
    } catch {
      addToast('Failed to disconnect', 'error');
    }
  };

  return (
    <div className="flex flex-col min-h-screen">
      <Header title="Settings" />

      <div className="flex-1 overflow-y-auto">
        {/* Server Configuration */}
        <section className="p-4">
          <h2 className="text-sm font-medium text-slate-400 uppercase mb-4">
            Server Connection
          </h2>
          <div className="space-y-4">
            <Input
              label="Server Host"
              placeholder="192.168.1.100"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              icon={<Server className="w-4 h-4" />}
            />
            <Input
              label="Port"
              type="number"
              placeholder="5000"
              value={port}
              onChange={(e) => setPort(e.target.value)}
            />
            <Input
              label="API Key"
              type="password"
              placeholder="Enter API key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              icon={<Key className="w-4 h-4" />}
            />

            {/* HTTPS Toggle */}
            <div className="flex items-center justify-between p-4 bg-slate-800 rounded-lg">
              <div className="flex items-center gap-3">
                {useHttps ? (
                  <Lock className="w-5 h-5 text-emerald-400" />
                ) : (
                  <Unlock className="w-5 h-5 text-slate-400" />
                )}
                <span className="text-sm text-white">Use HTTPS</span>
              </div>
              <button
                onClick={() => setUseHttps(!useHttps)}
                className={`w-12 h-6 rounded-full transition-colors ${
                  useHttps ? 'bg-emerald-500' : 'bg-slate-600'
                }`}
              >
                <div
                  className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    useHttps ? 'translate-x-6' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>

            <Button
              variant="primary"
              onClick={handleSave}
              loading={saving}
              className="w-full"
            >
              Save Connection Settings
            </Button>
          </div>
        </section>

        <div className="h-px bg-slate-700 mx-4" />

        {/* Storage */}
        <section className="p-4">
          <h2 className="text-sm font-medium text-slate-400 uppercase mb-4">
            Storage
          </h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-4 bg-slate-800 rounded-lg">
              <div className="flex items-center gap-3">
                <HardDrive className="w-5 h-5 text-slate-400" />
                <div>
                  <p className="text-sm text-white">Cached Audio</p>
                  <p className="text-xs text-slate-400">{formatFileSize(cacheSize)}</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={handleClearCache}>
                Clear
              </Button>
            </div>

            {/* Auto-cache while streaming */}
            <div className="flex items-center justify-between p-4 bg-slate-800 rounded-lg">
              <div className="flex items-center gap-3">
                <Zap className={`w-5 h-5 ${autoCacheEnabled ? 'text-emerald-400' : 'text-slate-400'}`} />
                <div>
                  <p className="text-sm text-white">Cache songs while streaming</p>
                  <p className="text-xs text-slate-400">
                    Reuse downloaded audio when seeking or replaying
                  </p>
                </div>
              </div>
              <button
                onClick={() => setAutoCacheEnabled(!autoCacheEnabled)}
                className={`w-12 h-6 rounded-full transition-colors shrink-0 ${
                  autoCacheEnabled ? 'bg-emerald-500' : 'bg-slate-600'
                }`}
              >
                <div
                  className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    autoCacheEnabled ? 'translate-x-6' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>

            {/* Cache size limit */}
            <div className="flex items-center justify-between p-4 bg-slate-800 rounded-lg">
              <div>
                <p className="text-sm text-white">Cache size limit</p>
                <p className="text-xs text-slate-400">
                  Oldest auto-cached songs are removed first. Downloads are kept.
                </p>
              </div>
              <select
                value={maxCacheSizeMB}
                onChange={handleMaxCacheSizeChange}
                className="bg-slate-700 text-white text-sm rounded-lg px-3 py-2 border border-slate-600 shrink-0"
              >
                <option value={512}>512 MB</option>
                <option value={1024}>1 GB</option>
                <option value={2048}>2 GB</option>
                <option value={5120}>5 GB</option>
                <option value={10240}>10 GB</option>
                <option value={0}>Unlimited</option>
              </select>
            </div>

            {/* Offline download format (server-side transcoding) */}
            <div className="p-4 bg-slate-800 rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-white">Download format</p>
                  <p className="text-xs text-slate-400">
                    Convert offline downloads (e.g. FLAC) to save space
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <select
                    value={downloadFormat}
                    onChange={handleDownloadFormatChange}
                    className="bg-slate-700 text-white text-sm rounded-lg px-3 py-2 border border-slate-600"
                  >
                    <option value="original">Original</option>
                    <option value="mp3">MP3</option>
                    <option value="aac">AAC</option>
                  </select>
                  {downloadFormat !== 'original' && (
                    <select
                      value={downloadBitrate}
                      onChange={(e) => setDownloadBitrate(parseInt(e.target.value))}
                      className="bg-slate-700 text-white text-sm rounded-lg px-3 py-2 border border-slate-600"
                    >
                      {(downloadFormat === 'mp3' ? [128, 192, 256, 320] : [96, 128, 192, 256]).map((rate) => (
                        <option key={rate} value={rate}>{rate} kbps</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
              {transcodeUnavailable && (
                <p className="mt-2 text-xs text-yellow-400">
                  FFmpeg is not available on the server, so transcoding is disabled.
                  Install FFmpeg on the TelegramFileManager host to enable it.
                </p>
              )}
            </div>
          </div>
        </section>

        <div className="h-px bg-slate-700 mx-4" />

        {/* Sound Enhancement */}
        <section className="p-4">
          <h2 className="text-sm font-medium text-slate-400 uppercase mb-4">
            Sound
          </h2>
          <div className="space-y-3">
            {/* Master toggle */}
            <div className="flex items-center justify-between p-4 bg-slate-800 rounded-lg">
              <div className="flex items-center gap-3">
                <Music2 className={`w-5 h-5 ${sound.enabled ? 'text-emerald-400' : 'text-slate-400'}`} />
                <div>
                  <p className="text-sm text-white">Sound enhancement</p>
                  <p className="text-xs text-slate-400">
                    Equalizer, bass boost, 3D stereo and volume leveling
                  </p>
                </div>
              </div>
              <button
                onClick={() => updateSound({ enabled: !sound.enabled })}
                className={`w-12 h-6 rounded-full transition-colors shrink-0 ${
                  sound.enabled ? 'bg-emerald-500' : 'bg-slate-600'
                }`}
              >
                <div
                  className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    sound.enabled ? 'translate-x-6' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>

            {sound.enabled && (
              <>
                {/* EQ presets */}
                <div className="p-4 bg-slate-800 rounded-lg">
                  <p className="text-xs text-slate-400 mb-2">Equalizer preset</p>
                  <div className="flex flex-wrap gap-2">
                    {EQ_PRESETS.map((preset) => (
                      <button
                        key={preset.key}
                        onClick={() => updateSound({ preset: preset.key, eqGains: [...preset.gains] })}
                        className={`px-3 py-1 text-sm rounded-full transition-colors ${
                          sound.preset === preset.key
                            ? 'bg-emerald-500 text-white'
                            : 'bg-slate-700 text-slate-300'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                    {sound.preset === 'custom' && (
                      <span className="px-3 py-1 text-sm rounded-full bg-emerald-500/20 text-emerald-400">
                        Custom
                      </span>
                    )}
                  </div>

                  {/* EQ bands */}
                  <div className="mt-4 space-y-1.5">
                    {EQ_BAND_LABELS.map((label, i) => (
                      <div key={label} className="flex items-center gap-3">
                        <span className="w-8 text-right text-[11px] text-slate-400 tabular-nums">
                          {label}
                        </span>
                        <input
                          type="range"
                          min={-12}
                          max={12}
                          step={1}
                          value={sound.eqGains[i] ?? 0}
                          onChange={(e) => handleEqBandChange(i, parseInt(e.target.value))}
                          className="flex-1"
                        />
                        <span className="w-10 text-[11px] text-slate-400 tabular-nums">
                          {(sound.eqGains[i] ?? 0) > 0 ? '+' : ''}{sound.eqGains[i] ?? 0} dB
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Bass boost */}
                <div className="p-4 bg-slate-800 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm text-white">Bass boost</p>
                    <span className="text-xs text-slate-400 tabular-nums">+{sound.bassBoost} dB</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={10}
                    step={1}
                    value={sound.bassBoost}
                    onChange={(e) => updateSound({ bassBoost: parseInt(e.target.value) })}
                    className="w-full"
                  />
                </div>

                {/* Stereo width */}
                <div className="p-4 bg-slate-800 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm text-white">3D stereo width</p>
                    <span className="text-xs text-slate-400 tabular-nums">+{sound.stereoWidth}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={sound.stereoWidth}
                    onChange={(e) => updateSound({ stereoWidth: parseInt(e.target.value) })}
                    className="w-full"
                  />
                </div>

                {/* Loudness */}
                <div className="flex items-center justify-between p-4 bg-slate-800 rounded-lg">
                  <div>
                    <p className="text-sm text-white">Volume leveling</p>
                    <p className="text-xs text-slate-400">
                      Evens out loudness differences between tracks
                    </p>
                  </div>
                  <button
                    onClick={() => updateSound({ loudness: !sound.loudness })}
                    className={`w-12 h-6 rounded-full transition-colors shrink-0 ${
                      sound.loudness ? 'bg-emerald-500' : 'bg-slate-600'
                    }`}
                  >
                    <div
                      className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${
                        sound.loudness ? 'translate-x-6' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
              </>
            )}
          </div>
        </section>

        <div className="h-px bg-slate-700 mx-4" />

        {/* About */}
        <section className="p-4">
          <h2 className="text-sm font-medium text-slate-400 uppercase mb-4">
            About
          </h2>
          <div className="flex items-center gap-3 p-4 bg-slate-800 rounded-lg">
            <Info className="w-5 h-5 text-slate-400" />
            <div>
              <p className="text-sm text-white">TFM Audio PWA</p>
              <p className="text-xs text-slate-400">Version {APP_CONFIG.version}</p>
              <p className="text-xs text-slate-500">Build: {APP_CONFIG.buildTimestamp}</p>
            </div>
          </div>
        </section>

        <div className="h-px bg-slate-700 mx-4" />

        {/* Danger Zone */}
        <section className="p-4">
          <h2 className="text-sm font-medium text-red-400 uppercase mb-4">
            Danger Zone
          </h2>
          <Button
            variant="danger"
            icon={<Trash2 className="w-4 h-4" />}
            onClick={handleLogout}
            className="w-full"
          >
            Disconnect from Server
          </Button>
        </section>
      </div>
    </div>
  );
}
