import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Server, Key, Lock, Unlock, Trash2, HardDrive, Info } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { db, getServerConfig, saveServerConfig, clearServerConfig } from '@/db/database';
import { apiClient } from '@/services/api/client';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUiStore } from '@/stores/uiStore';
import { formatFileSize } from '@/utils/format';

// App version with build timestamp
const APP_VERSION = '1.2.0';
const BUILD_TIMESTAMP = '__BUILD_TIMESTAMP__'; // Will be replaced by Vite

export function SettingsPage() {
  const navigate = useNavigate();
  const { clearSettings } = useSettingsStore();
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
              <p className="text-xs text-slate-400">Version {APP_VERSION}</p>
              <p className="text-xs text-slate-500">Build: {BUILD_TIMESTAMP}</p>
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
