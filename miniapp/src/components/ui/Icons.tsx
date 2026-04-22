import React from 'react';

interface IconProps {
  active?: boolean;
}

export function IconHome({ active }: IconProps) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path 
        d="M3 12L12 4L21 12" 
        stroke={active ? '#3B82F6' : 'currentColor'} 
        strokeWidth="2" 
        strokeLinecap="round" 
        strokeLinejoin="round"
      />
      <path 
        d="M5 10V19C5 19.5523 5.44772 20 6 20H9V15C9 14.4477 9.44772 14 10 14H14C14.5523 14 15 14.4477 15 15V20H18C18.5523 20 19 19.5523 19 19V10" 
        stroke={active ? '#3B82F6' : 'currentColor'} 
        strokeWidth="2" 
        strokeLinecap="round" 
        strokeLinejoin="round"
        fill={active ? 'rgba(59, 130, 246, 0.15)' : 'none'}
      />
    </svg>
  );
}

export function IconCompute({ active }: IconProps) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <rect 
        x="3" y="6" width="18" height="12" rx="2" 
        stroke={active ? '#3B82F6' : 'currentColor'} 
        strokeWidth="2"
        fill={active ? 'rgba(59, 130, 246, 0.15)' : 'none'}
      />
      <path d="M7 10H12" stroke={active ? '#3B82F6' : 'currentColor'} strokeWidth="2" strokeLinecap="round"/>
      <path d="M7 14H10" stroke={active ? '#3B82F6' : 'currentColor'} strokeWidth="2" strokeLinecap="round"/>
      <circle cx="17" cy="12" r="2" fill={active ? '#3B82F6' : 'currentColor'} />
    </svg>
  );
}

export function IconStats({ active }: IconProps) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <rect x="4" y="12" width="4" height="8" rx="1" fill={active ? '#3B82F6' : 'currentColor'} opacity={active ? 1 : 0.6} />
      <rect x="10" y="8" width="4" height="12" rx="1" fill={active ? '#3B82F6' : 'currentColor'} opacity={active ? 1 : 0.8} />
      <rect x="16" y="4" width="4" height="16" rx="1" fill={active ? '#3B82F6' : 'currentColor'} />
    </svg>
  );
}

export function SmainerLogo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="100 80 312 352" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Official: 7 compute blocks in distributed S-formation */}
      <rect x="200" y="104" width="112" height="48" rx="8" fill="#FFFFFF" />
      <rect x="328" y="104" width="48" height="48" rx="8" fill="#3B82F6" />
      <rect x="136" y="168" width="48" height="48" rx="8" fill="#FFFFFF" />
      <rect x="200" y="232" width="112" height="48" rx="8" fill="#FFFFFF" />
      <rect x="328" y="296" width="48" height="48" rx="8" fill="#FFFFFF" />
      <rect x="136" y="360" width="48" height="48" rx="8" fill="#3B82F6" />
      <rect x="200" y="360" width="112" height="48" rx="8" fill="#FFFFFF" />
    </svg>
  );
}