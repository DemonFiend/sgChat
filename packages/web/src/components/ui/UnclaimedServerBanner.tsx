interface UnclaimedServerBannerProps {
  isVisible: boolean;
  onClaimClick: () => void;
}

export function UnclaimedServerBanner({ isVisible, onClaimClick }: UnclaimedServerBannerProps) {
  if (!isVisible) return null;

  return (
    <div className="bg-warning/20 border-b border-warning/30 px-4 py-2.5">
      <div className="flex items-center justify-between max-w-screen-xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0">
            <svg className="w-5 h-5 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-text-primary">
              This server has no owner yet!
            </p>
            <p className="text-xs text-text-muted">
              If you deployed this server, claim ownership with your admin code.
            </p>
          </div>
        </div>
        <button
          onClick={onClaimClick}
          className="px-4 py-1.5 bg-warning text-black text-sm font-medium rounded hover:bg-warning/90 transition-colors whitespace-nowrap"
        >
          Claim Ownership
        </button>
      </div>
    </div>
  );
}
