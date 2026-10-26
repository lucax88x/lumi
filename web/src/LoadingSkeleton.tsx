type LoadingSkeletonProps = {
  label: string;
  variant?: 'list' | 'dictionary' | 'messages';
  rows?: number;
};

export function LoadingSkeleton({ label, variant = 'list', rows = 3 }: LoadingSkeletonProps) {
  return <div className={`loading-skeleton loading-skeleton-${variant}`} role="status" aria-label={label} aria-busy="true">
    <div aria-hidden="true">
      {variant === 'dictionary' && <>
        <div className="dictionary-toolbar">
          <div className="dictionary-search"><span className="skeleton skeleton-label"/><span className="skeleton skeleton-input"/></div>
          <span className="skeleton skeleton-button"/>
        </div>
        <div className="dictionary-count"><span className="skeleton skeleton-caption"/></div>
      </>}
      <div className="skeleton-rows">{Array.from({ length: rows }, (_, index) => <div className="skeleton-row" key={index}>
        <div className="skeleton-lines"><span className="skeleton skeleton-title"/><span className="skeleton skeleton-caption"/>{variant === 'messages' && <span className="skeleton skeleton-paragraph"/>}</div>
        {variant !== 'messages' && <span className="skeleton skeleton-trailing"/>}
      </div>)}</div>
    </div>
  </div>;
}
