import { createSignal, Show, For, createEffect, onCleanup } from 'solid-js';
import { clsx } from 'clsx';
import { networkStore, type Network, type ConnectionStatus } from '@/stores/network';

interface NetworkSelectorProps {
  onNetworkReady?: (url: string) => void;
  showAutoLoginToggle?: boolean;
  showSetDefaultCheckbox?: boolean;
  class?: string;
}

export function NetworkSelector(props: NetworkSelectorProps) {
  const [inputValue, setInputValue] = createSignal('');
  const [isDropdownOpen, setIsDropdownOpen] = createSignal(false);
  const [setAsDefault, setSetAsDefault] = createSignal(false);
  let inputRef: HTMLInputElement | undefined;
  let dropdownRef: HTMLDivElement | undefined;

  // Initialize input with last network or default
  createEffect(() => {
    const defaultNet = networkStore.defaultNetwork();
    const currentUrl = networkStore.currentUrl();
    
    if (currentUrl) {
      setInputValue(currentUrl);
    } else if (defaultNet) {
      setInputValue(defaultNet.url);
      // Auto-test default network on mount
      networkStore.testConnection(defaultNet.url);
    }
  });

  // Notify parent when connected
  createEffect(() => {
    if (networkStore.connectionStatus() === 'connected' && networkStore.currentUrl()) {
      props.onNetworkReady?.(networkStore.currentUrl()!);
    }
  });

  // Close dropdown on outside click
  const handleClickOutside = (e: MouseEvent) => {
    if (dropdownRef && !dropdownRef.contains(e.target as Node)) {
      setIsDropdownOpen(false);
    }
  };

  createEffect(() => {
    if (isDropdownOpen()) {
      document.addEventListener('mousedown', handleClickOutside);
    } else {
      document.removeEventListener('mousedown', handleClickOutside);
    }
  });

  onCleanup(() => {
    document.removeEventListener('mousedown', handleClickOutside);
  });

  const handleConnect = async () => {
    const url = inputValue().trim();
    if (!url) return;

    const info = await networkStore.testConnection(url);
    if (info) {
      // Update network with server name
      networkStore.addOrUpdateNetwork(url, {
        name: info.name,
        lastConnected: new Date().toISOString(),
        isDefault: setAsDefault(),
      });
    }
  };

  const handleSelectNetwork = (network: Network) => {
    setInputValue(network.url);
    setIsDropdownOpen(false);
    networkStore.testConnection(network.url);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConnect();
    } else if (e.key === 'Escape') {
      setIsDropdownOpen(false);
    }
  };

  const handleToggleFavorite = (e: MouseEvent, url: string) => {
    e.stopPropagation();
    networkStore.toggleFavorite(url);
  };

  const statusIcon = (status: ConnectionStatus) => {
    switch (status) {
      case 'testing':
        return (
          <svg class="w-4 h-4 animate-spin text-text-muted" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        );
      case 'connected':
        return (
          <svg class="w-4 h-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
          </svg>
        );
      case 'failed':
        return (
          <svg class="w-4 h-4 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        );
      default:
        return null;
    }
  };

  const favorites = () => networkStore.favoriteNetworks();
  const recents = () => networkStore.recentNetworks();
  const hasNetworks = () => favorites().length > 0 || recents().length > 0;

  return (
    <div class={clsx('flex flex-col gap-2', props.class)} ref={dropdownRef}>
      {/* Label */}
      <label class="text-xs font-semibold uppercase tracking-wide text-text-secondary">
        Network
        <Show when={networkStore.connectionError()}>
          <span class="text-danger font-normal normal-case"> - {networkStore.connectionError()}</span>
        </Show>
      </label>

      {/* Input with dropdown */}
      <div class="relative">
        <div class="flex gap-2">
          <div class="relative flex-1">
            <input
              ref={inputRef}
              type="url"
              value={inputValue()}
              onInput={(e) => setInputValue(e.currentTarget.value)}
              onFocus={() => hasNetworks() && setIsDropdownOpen(true)}
              onKeyDown={handleKeyDown}
              placeholder="https://chat.example.com"
              class={clsx(
                'w-full h-10 pl-3 pr-10 rounded-md bg-bg-tertiary text-text-primary',
                'border outline-none transition-colors',
                'placeholder:text-text-muted',
                networkStore.connectionStatus() === 'connected'
                  ? 'border-success'
                  : networkStore.connectionStatus() === 'failed'
                  ? 'border-danger'
                  : 'border-transparent focus:border-accent'
              )}
            />
            
            {/* Status indicator inside input */}
            <div class="absolute right-3 top-1/2 -translate-y-1/2">
              {statusIcon(networkStore.connectionStatus())}
            </div>
          </div>

          {/* Connect button */}
          <button
            onClick={handleConnect}
            disabled={!inputValue().trim() || networkStore.connectionStatus() === 'testing'}
            class={clsx(
              'px-4 h-10 rounded-md font-medium transition-colors',
              'bg-accent hover:bg-accent-hover text-white',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {networkStore.connectionStatus() === 'testing' ? 'Testing...' : 'Connect'}
          </button>

          {/* Favorite button */}
          <Show when={networkStore.connectionStatus() === 'connected'}>
            <button
              onClick={() => networkStore.toggleFavorite(inputValue())}
              class={clsx(
                'w-10 h-10 rounded-md flex items-center justify-center transition-colors',
                'hover:bg-bg-modifier-hover',
                networkStore.currentNetwork()?.isFavorite ? 'text-warning' : 'text-text-muted'
              )}
              title={networkStore.currentNetwork()?.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            >
              <svg class="w-5 h-5" fill={networkStore.currentNetwork()?.isFavorite ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
            </button>
          </Show>
        </div>

        {/* Dropdown */}
        <Show when={isDropdownOpen() && hasNetworks()}>
          <div class="absolute z-50 top-full left-0 right-0 mt-1 py-1 bg-bg-tertiary rounded-md shadow-high border border-border max-h-64 overflow-y-auto">
            {/* Default network */}
            <Show when={networkStore.defaultNetwork()}>
              <div class="px-2 py-1">
                <div class="text-xs font-semibold uppercase text-text-muted px-2 py-1">Default</div>
                <NetworkItem
                  network={networkStore.defaultNetwork()!}
                  isSelected={inputValue() === networkStore.defaultNetwork()!.url}
                  onSelect={handleSelectNetwork}
                  onToggleFavorite={handleToggleFavorite}
                  showDefault
                />
              </div>
            </Show>

            {/* Favorites */}
            <Show when={favorites().length > 0}>
              <div class="px-2 py-1">
                <div class="text-xs font-semibold uppercase text-text-muted px-2 py-1 flex items-center gap-1">
                  <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                  Favorites
                </div>
                <For each={favorites().filter(n => !n.isDefault)}>
                  {(network) => (
                    <NetworkItem
                      network={network}
                      isSelected={inputValue() === network.url}
                      onSelect={handleSelectNetwork}
                      onToggleFavorite={handleToggleFavorite}
                    />
                  )}
                </For>
              </div>
            </Show>

            {/* Recents */}
            <Show when={recents().length > 0}>
              <div class="px-2 py-1">
                <div class="text-xs font-semibold uppercase text-text-muted px-2 py-1 flex items-center gap-1">
                  <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Recent
                </div>
                <For each={recents()}>
                  {(network) => (
                    <NetworkItem
                      network={network}
                      isSelected={inputValue() === network.url}
                      onSelect={handleSelectNetwork}
                      onToggleFavorite={handleToggleFavorite}
                    />
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Show>
      </div>

      {/* Connection info */}
      <Show when={networkStore.connectionStatus() === 'connected' && networkStore.serverInfo()}>
        <div class="flex items-center gap-2 text-sm text-success">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
          </svg>
          <span>
            Connected to "{networkStore.serverInfo()!.name}" v{networkStore.serverInfo()!.version}
          </span>
        </div>
      </Show>

      {/* Options row */}
      <Show when={networkStore.connectionStatus() === 'connected'}>
        <div class="flex items-center gap-4 text-sm">
          <Show when={props.showSetDefaultCheckbox}>
            <label class="flex items-center gap-2 cursor-pointer text-text-secondary hover:text-text-primary">
              <input
                type="checkbox"
                checked={setAsDefault() || networkStore.currentNetwork()?.isDefault}
                onChange={(e) => {
                  setSetAsDefault(e.currentTarget.checked);
                  if (e.currentTarget.checked) {
                    networkStore.setAsDefault(inputValue());
                  } else {
                    networkStore.setAsDefault(null);
                  }
                }}
                class="w-4 h-4 rounded border-border bg-bg-tertiary accent-accent"
              />
              Set as default
            </label>
          </Show>

          <Show when={props.showAutoLoginToggle}>
            <label class="flex items-center gap-2 cursor-pointer text-text-secondary hover:text-text-primary">
              <input
                type="checkbox"
                checked={networkStore.autoLogin()}
                onChange={(e) => networkStore.setAutoLogin(e.currentTarget.checked)}
                class="w-4 h-4 rounded border-border bg-bg-tertiary accent-accent"
              />
              Auto-login on startup
            </label>
          </Show>
        </div>
      </Show>
    </div>
  );
}

interface NetworkItemProps {
  network: Network;
  isSelected: boolean;
  onSelect: (network: Network) => void;
  onToggleFavorite: (e: MouseEvent, url: string) => void;
  showDefault?: boolean;
}

function NetworkItem(props: NetworkItemProps) {
  const displayUrl = () => {
    try {
      const url = new URL(props.network.url);
      return url.host;
    } catch {
      return props.network.url;
    }
  };

  return (
    <button
      onClick={() => props.onSelect(props.network)}
      class={clsx(
        'flex items-center gap-2 w-full px-2 py-2 rounded text-left transition-colors',
        props.isSelected ? 'bg-bg-modifier-selected' : 'hover:bg-bg-modifier-hover'
      )}
    >
      {/* Favorite star */}
      <button
        onClick={(e) => props.onToggleFavorite(e, props.network.url)}
        class={clsx(
          'p-1 rounded hover:bg-bg-modifier-active',
          props.network.isFavorite ? 'text-warning' : 'text-text-muted'
        )}
      >
        <svg class="w-4 h-4" fill={props.network.isFavorite ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
        </svg>
      </button>

      {/* Network info */}
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="font-medium text-text-primary truncate">{props.network.name}</span>
          <Show when={props.network.isDefault}>
            <span class="text-xs bg-accent/20 text-accent px-1.5 py-0.5 rounded">Default</span>
          </Show>
        </div>
        <div class="text-xs text-text-muted truncate">{displayUrl()}</div>
      </div>

      {/* Account count */}
      <Show when={props.network.accounts.length > 0}>
        <span class="text-xs text-text-muted">
          {props.network.accounts.length} account{props.network.accounts.length !== 1 ? 's' : ''}
        </span>
      </Show>
    </button>
  );
}
