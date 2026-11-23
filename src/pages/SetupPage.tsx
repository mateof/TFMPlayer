import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Server, Key, Lock, Unlock, Wifi, WifiOff } from 'lucide-react';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { saveServerConfig } from '@/db/database';
import { apiClient } from '@/services/api/client';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUiStore } from '@/stores/uiStore';
import { t } from '@/i18n';

export function SetupPage() {
  const navigate = useNavigate();
  const { setServerInfo } = useSettingsStore();
  const { addToast } = useUiStore();

  const [host, setHost] = useState('');
  const [port, setPort] = useState('5000');
  const [apiKey, setApiKey] = useState('');
  const [useHttps, setUseHttps] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const handleTestConnection = async () => {
    if (!host || !apiKey) {
      addToast(t('Please fill in all required fields'), 'warning');
      return;
    }

    setTesting(true);
    setConnectionStatus('idle');

    try {
      const success = await apiClient.testConnection(host, parseInt(port), apiKey, useHttps);
      setConnectionStatus(success ? 'success' : 'error');
      if (success) {
        addToast(t('Connection successful!'), 'success');
      } else {
        addToast(t('Connection failed. Check your settings.'), 'error');
      }
    } catch {
      setConnectionStatus('error');
      addToast(t('Connection failed. Check your settings.'), 'error');
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!host || !apiKey) {
      addToast(t('Please fill in all required fields'), 'warning');
      return;
    }

    if (connectionStatus !== 'success') {
      addToast(t('Please test the connection first'), 'warning');
      return;
    }

    try {
      await saveServerConfig({
        host,
        port: parseInt(port),
        apiKey,
        useHttps
      });

      setServerInfo(host, parseInt(port), useHttps);
      apiClient.clearCache();
      addToast(t('Configuration saved!'), 'success');
      navigate('/channels');
    } catch {
      addToast(t('Failed to save configuration'), 'error');
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-900">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <Server className="w-10 h-10 text-emerald-500" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">TFM Audio</h1>
          <p className="text-slate-400">{t('Configure your server connection')}</p>
        </div>

        {/* Form */}
        <div className="space-y-4">
          <Input
            label={t('Server Host')}
            placeholder={t('192.168.1.100 or example.com')}
            value={host}
            onChange={(e) => setHost(e.target.value)}
            icon={<Server className="w-4 h-4" />}
          />

          <Input
            label={t('Port')}
            type="number"
            placeholder="5000"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            icon={<Server className="w-4 h-4" />}
          />

          <Input
            label={t('API Key')}
            type="password"
            placeholder={t('Enter your API key')}
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
              <div>
                <p className="text-sm font-medium text-white">{t('Use HTTPS')}</p>
                <p className="text-xs text-slate-400">{t('Enable secure connection')}</p>
              </div>
            </div>
            <button
              onClick={() => setUseHttps(!useHttps)}
              className={`w-12 h-6 rounded-full transition-colors ${
                useHttps ? 'bg-emerald-500' : 'bg-slate-600'
              }`}
            >
              <div
                className={`w-5 h-5 bg-[#fff] rounded-full shadow transition-transform ${
                  useHttps ? 'translate-x-6' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          {/* Connection status */}
          {connectionStatus !== 'idle' && (
            <div
              className={`flex items-center gap-2 p-3 rounded-lg ${
                connectionStatus === 'success'
                  ? 'bg-emerald-900/50 text-emerald-400'
                  : 'bg-red-900/50 text-red-400'
              }`}
            >
              {connectionStatus === 'success' ? (
                <Wifi className="w-5 h-5" />
              ) : (
                <WifiOff className="w-5 h-5" />
              )}
              <span className="text-sm">
                {connectionStatus === 'success'
                  ? t('Connection successful')
                  : t('Connection failed')}
              </span>
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-3 pt-4">
            <Button
              variant="secondary"
              onClick={handleTestConnection}
              loading={testing}
              className="flex-1"
            >
              {t('Test Connection')}
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={connectionStatus !== 'success'}
              className="flex-1"
            >
              {t('Save & Continue')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
