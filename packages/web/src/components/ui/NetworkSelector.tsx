import { useState, useEffect, useRef, useCallback } from 'react';
import { clsx } from 'clsx';
import { useNetworkStore, type Network, type ConnectionStatus } from '@/stores/network';

interface NetworkSelectorProps {
  onNetworkReady?: (url: string) => void;
  showAutoLoginToggle?: boolean;
  showSetDefaultCheckbox?: boolean;
  className?: string;
}

export function NetworkSelector({ onNetworkReady, showAutoLoginToggle, showSetDefaultCheckbox, className }: NetworkSelectorProps) {
  const [inputValue, setInputValue] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [setAsDefault, setSetAsDefault] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const {
    currentUrl, connectionStatus, connectionError, serverInfo,
    testConnection, addOrUpdateNetwork, toggleFavorite, setAsDefault: storeSetAsDefault,
    autoLogin, setAutoLogin,
    currentNetwork, defaultNetwork, favoriteNetworks, recentNetworks,
  } = useNetworkStore();

  const currentNet = currentNetwork();
  const defaultNet = defaultNetwork();
  const favorites = favoriteNetworks();
  const recents = recentNetworks();
  const hasNetworks = favorites.length > 0 || recents.length > 0;

  // Initialize input with last network or default
  useEffect(() => {
    if (currentUrl) {
      setInputValue(currentUrl);
    } else if (defaultNet) {
      setInputValue(defaultNet.url);
      testConnection(defaultNet.url);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Notify parent when connected
  useEffect(() => {
    if (connectionStatus === 'connected' && currentUrl) {
      onNetworkReady?.(currentUrl);
    }
  }, [connectionStatus, currentUrl, onNetworkReady]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!isDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isDropdownOpen]);

  const handleConnect = useCallback(async () => {
    const url = inputValue.trim();
    if (!url) return;
    const info = await testConnection(url);
    if (info) {
      addOrUpdateNetwork(url, {
        name: info.name,
        lastConnected: new Date().toISOString(),
        isDefault: setAsDefault,
      });
    }
  }, [inputValue, setAsDefault, testConnection, addOrUpdateNetwork]);

  const handleSelectNetwork = useCallback((network: Network) => {
    setInputValue(network.url);
    setIsDropdownOpen(false);
    testConnection(network.url);
  }, [testConnection]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConnect();
    } else if (e.key === 'Escape') {
      setIsDropdownOpen(false);
    }
  }, [handleConnect]);

  const handleToggleFavorite = useCallback((e: React.MouseEvent, url: string) => {
    e.stopPropagation();
    toggleFavorite(url);
  }, [toggleFavorite]);

  return (
    <div className={clsx('flex flex-col gap-2', className)} ref={dropdownRef}>
      {/* Label */}
      <label className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
        Network
        {connectionError && (
          <span className="text-danger font-normal normal-case"> - {connectionError}</span>
        )}
      </label>

      {/* Input with dropdown */}
      <div className="relative">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="url"
              name="server-url"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onFocus={() => hasNetworks && setIsDropdownOpen(true)}
              onKeyDown={handleKeyDown}
              placeholder="https://chat.example.com"
              className={clsx(
                'w-full h-10 pl-3 pr-10 rounded-md bg-bg-tertiary text-text-primary',
                'border outline-none transition-colors',
                'placeholder:text-text-muted',
                connectionStatus === 'connected'
                  ? 'border-success'
                  : connectionStatus === 'failed'
                  ? 'border-danger'
                  : 'border-transparent focus:border-accent'
              )}
            />
            {/* Status indicator inside input */}
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <StatusIcon status={connectionStatus} />
            </div>
          </div>

          {/* Connect button */}
          <button
            onClick={handleConnect}
            disabled={!inputValue.trim() || connectionStatus === 'testing'}
            className={clsx(
              'px-4 h-10 rounded-md font-medium transition-colors',
              'bg-accent hover:bg-accent-hover text-white',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {connectionStatus === 'testing' ? 'Testing...' : 'Connect'}
          </button>

          {/* Favorite button */}
          {connectionStatus === 'connected' && (
            <button
              onClick={() => toggleFavorite(inputValue)}
              className={clsx(
                'w-10 h-10 rounded-md flex items-center justify-center transition-colors',
                'hover:bg-bg-modifier-hover',
                currentNet?.isFavorite ? 'text-warning' : 'text-text-muted'
              )}
              title={currentNet?.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            >
              <svg className="w-5 h-5" fill={currentNet?.isFavorite ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
            </button>
          )}
        </div>

        {/* Dropdown */}
        {isDropdownOpen && hasNetworks && (
          <div className="absolute z-50 top-full left-0 right-0 mt-1 py-1 bg-bg-tertiary rounded-md shadow-high border border-border max-h-64 overflow-y-auto">
            {/* Default network */}
            {defaultNet && (
              <div className="px-2 py-1">
                <div className="text-xs font-semibold uppercase text-text-muted px-2 py-1">Default</div>
                <NetworkItem
                  network={defaultNet}
                  isSelected={inputValue === defaultNet.url}
                  onSelect={handleSelectNetwork}
                  onToggleFavorite={handleToggleFavorite}
                  showDefault
                />
              </div>
            )}

            {/* Favorites */}
            {favorites.length > 0 && (
              <div className="px-2 py-1">
                <div className="text-xs font-semibold uppercase text-text-muted px-2 py-1 flex items-center gap-1">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                  Favorites
                </div>
                {favorites.filter((n) => !n.isDefault).map((network) => (
                  <NetworkItem
                    key={network.url}
                    network={network}
                    isSelected={inputValue === network.url}
                    onSelect={handleSelectNetwork}
                    onToggleFavorite={handleToggleFavorite}
                  />
                ))}
              </div>
            )}

            {/* Recents */}
            {recents.length > 0 && (
              <div className="px-2 py-1">
                <div className="text-xs font-semibold uppercase text-text-muted px-2 py-1 flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Recent
                </div>
                {recents.map((network) => (
                  <NetworkItem
                    key={network.url}
                    network={network}
                    isSelected={inputValue === network.url}
                    onSelect={handleSelectNetwork}
                    onToggleFavorite={handleToggleFavorite}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Connection info */}
      {connectionStatus === 'connected' && serverInfo && (
        <div className="flex items-center gap-2 text-sm text-success">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
          </svg>
          <span>
            Connected to &quot;{serverInfo.name}&quot; v{serverInfo.version}
          </span>
        </div>
      )}

      {/* Options row */}
      {connectionStatus === 'connected' && (
        <div className="flex items-center gap-4 text-sm">
          {showSetDefaultCheckbox && (
            <label className="flex items-center gap-2 cursor-pointer text-text-secondary hover:text-text-primary">
              <input
                type="checkbox"
                name="set-default-server"
                checked={setAsDefault || !!currentNet?.isDefault}
                onChange={(e) => {
                  setSetAsDefault(e.target.checked);
                  if (e.target.checked) {
                    storeSetAsDefault(inputValue);
                  } else {
                    storeSetAsDefault(null);
                  }
                }}
                className="w-4 h-4 rounded border-border bg-bg-tertiary accent-accent"
              />
              Set as default
            </label>
          )}

          {showAutoLoginToggle && (
            <label className="flex items-center gap-2 cursor-pointer text-text-secondary hover:text-text-primary">
              <input
                type="checkbox"
                name="auto-login"
                checked={autoLogin}
                onChange={(e) => setAutoLogin(e.target.checked)}
                className="w-4 h-4 rounded border-border bg-bg-tertiary accent-accent"
              />
              Auto-login on startup
            </label>
          )}
        </div>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: ConnectionStatus }) {
  switch (status) {
    case 'testing':
      return (
        <svg className="w-4 h-4 animate-spin text-text-muted" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      );
    case 'connected':
      return (
        <svg className="w-4 h-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
        </svg>
      );
    case 'failed':
      return (
        <svg className="w-4 h-4 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      );
    default:
      return null;
  }
}

interface NetworkItemProps {
  network: Network;
  isSelected: boolean;
  onSelect: (network: Network) => void;
  onToggleFavorite: (e: React.MouseEvent, url: string) => void;
  showDefault?: boolean;
}

function NetworkItem({ network, isSelected, onSelect, onToggleFavorite }: NetworkItemProps) {
  const displayUrl = () => {
    try {
      return new URL(network.url).host;
    } catch {
      return network.url;
    }
  };

  return (
    <button
      onClick={() => onSelect(network)}
      className={clsx(
        'flex items-center gap-2 w-full px-2 py-2 rounded text-left transition-colors',
        isSelected ? 'bg-bg-modifier-selected' : 'hover:bg-bg-modifier-hover'
      )}
    >
      {/* Favorite star */}
      <button
        onClick={(e) => onToggleFavorite(e, network.url)}
        className={clsx(
          'p-1 rounded hover:bg-bg-modifier-active',
          network.isFavorite ? 'text-warning' : 'text-text-muted'
        )}
      >
        <svg className="w-4 h-4" fill={network.isFavorite ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
        </svg>
      </button>

      {/* Network info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-text-primary truncate">{network.name}</span>
          {network.isDefault && (
            <span className="text-xs bg-accent/20 text-accent px-1.5 py-0.5 rounded">Default</span>
          )}
        </div>
        <div className="text-xs text-text-muted truncate">{displayUrl()}</div>
      </div>

      {/* Account count */}
      {network.accounts.length > 0 && (
        <span className="text-xs text-text-muted">
          {network.accounts.length} account{network.accounts.length !== 1 ? 's' : ''}
        </span>
      )}
    </button>
  );
}
