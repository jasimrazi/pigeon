import React, { useState } from 'react';
import { Globe } from 'lucide-react';

export interface SourceLogoProps {
  source: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  showName?: boolean;
  className?: string;
}

const BRAND_NAMES: Record<string, string> = {
  linkedin: 'LinkedIn',
  indeed: 'Indeed',
  naukri: 'Naukri',
  wellfound: 'Wellfound',
  otta: 'Otta',
  ziprecruiter: 'ZipRecruiter',
  dice: 'Dice',
  glassdoor: 'Glassdoor',
  instahyre: 'Instahyre',
  foundit: 'Foundit',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  smartrecruiters: 'SmartRecruiters',
  workable: 'Workable',
  breezy: 'Breezy HR',
  bamboohr: 'BambooHR',
  recruitee: 'Recruitee',
  adzuna: 'Adzuna',
  remoteok: 'RemoteOK',
  remotive: 'Remotive',
  weworkremotely: 'We Work Remotely',
  hiring_hn: 'Hacker News',
  himalayas: 'Himalayas',
  jobicy: 'Jobicy',
  workingnomads: 'Working Nomads',
};

export function getSourceDisplayName(source: string): string {
  const normalized = source.toLowerCase().trim();
  if (BRAND_NAMES[normalized]) {
    return BRAND_NAMES[normalized];
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function SourceLogo({
  source,
  size = 'md',
  showName = false,
  className = '',
}: SourceLogoProps): React.JSX.Element {
  const norm = source.toLowerCase().trim();
  const displayName = getSourceDisplayName(source);
  const [imgFailed, setImgFailed] = useState(false);

  const sizeDimensions = {
    xs: { box: 'w-4 h-4', icon: 12, text: 'text-[11px]' },
    sm: { box: 'w-5 h-5', icon: 14, text: 'text-[12px]' },
    md: { box: 'w-7 h-7', icon: 18, text: 'text-[13px]' },
    lg: { box: 'w-9 h-9', icon: 24, text: 'text-[15px]' },
  }[size];

  const logoSrc = `/logos/${norm}.png`;

  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <div
        className={`${sizeDimensions.box} shrink-0 rounded-[5px] overflow-hidden bg-surface-subtle border border-border flex items-center justify-center p-0.5 shadow-xs`}
        title={displayName}
      >
        {!imgFailed ? (
          <img
            src={logoSrc}
            alt={displayName}
            className="w-full h-full object-contain rounded-[3px]"
            loading="lazy"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <Globe size={sizeDimensions.icon} className="text-fg-muted" aria-hidden="true" />
        )}
      </div>
      {showName && (
        <span className={`font-medium text-fg ${sizeDimensions.text}`}>{displayName}</span>
      )}
    </div>
  );
}
