import { useImpersonationStore } from '@/stores/impersonation';
import { useEffect } from 'react';
import { socketService } from '@/lib/socket';

export function ImpersonationBanner() {
  const { isActive, serverId, selectedRoleIds, allRoles, hasAdministrator, fetchPreview, deactivate, setRoleIds } =
    useImpersonationStore();

  // Subscribe to socket events that should trigger a preview refresh
  useEffect(() => {
    if (!isActive || !serverId) return;

    const handleRefresh = () => {
      fetchPreview();
    };

    const handleRoleDelete = (data: any) => {
      const deletedRoleId = data?.role?.id || data?.id;
      if (!deletedRoleId) return;

      const { selectedRoleIds: currentIds } = useImpersonationStore.getState();
      if (currentIds.includes(deletedRoleId)) {
        setRoleIds(currentIds.filter((id) => id !== deletedRoleId));
      }
    };

    const handleRoleUpdate = (data: any) => {
      const updatedRoleId = data?.role?.id || data?.id;
      if (!updatedRoleId) return;

      const { selectedRoleIds: currentIds } = useImpersonationStore.getState();
      if (currentIds.includes(updatedRoleId)) {
        fetchPreview();
      }
    };

    // Server navigation — deactivate impersonation
    const handleServerChange = () => {
      deactivate();
    };

    socketService.on('channel.create', handleRefresh);
    socketService.on('channel.delete', handleRefresh);
    socketService.on('channel.update', handleRefresh);
    socketService.on('category.create', handleRefresh);
    socketService.on('category.delete', handleRefresh);
    socketService.on('role.update', handleRoleUpdate);
    socketService.on('role.delete', handleRoleDelete);
    socketService.on('server.kicked', handleServerChange);
    socketService.on('server.banned', handleServerChange);

    return () => {
      socketService.off('channel.create', handleRefresh);
      socketService.off('channel.delete', handleRefresh);
      socketService.off('channel.update', handleRefresh);
      socketService.off('category.create', handleRefresh);
      socketService.off('category.delete', handleRefresh);
      socketService.off('role.update', handleRoleUpdate);
      socketService.off('role.delete', handleRoleDelete);
      socketService.off('server.kicked', handleServerChange);
      socketService.off('server.banned', handleServerChange);
    };
  }, [isActive, serverId, selectedRoleIds, fetchPreview, deactivate, setRoleIds]);

  if (!isActive) return null;

  const roleNames = selectedRoleIds
    .map((id) => allRoles.find((r) => r.id === id)?.name)
    .filter(Boolean);

  return (
    <div className="fixed top-0 left-0 right-0 z-40 flex items-center justify-center gap-2 px-4 py-2 bg-amber-500/90 text-black font-semibold text-sm">
      <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
          clipRule="evenodd"
        />
      </svg>
      <span>
        Role Impersonation Active
        {hasAdministrator && ' — This role set has Administrator (all permissions granted)'}
        {!hasAdministrator && roleNames.length > 0 && ` — Viewing as: ${roleNames.join(', ')}`}
      </span>
      <span className="ml-1 font-normal opacity-75">Your actual permissions are not affected.</span>
    </div>
  );
}
