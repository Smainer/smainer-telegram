import React from 'react';

/**
 * AnimatedLogo - Refined branded logo with subtle floating animation.
 * 
 * Usage: <AnimatedLogo size={64} />
 * 
 * Implements a gentle float effect while maintaining the static block arrangement
 * for a premium, non-distracting feel.
 */

const styles = `
@keyframes gentleFloat {
  0% {
    transform: translateY(0px);
  }
  50% {
    transform: translateY(-4px);
  }
  100% {
    transform: translateY(0px);
  }
}

.smainer-logo-container {
  animation: gentleFloat 3s ease-in-out infinite;
}

.smainer-logo-glow {
  filter: drop-shadow(0 0 12px rgba(59, 130, 246, 0.4));
}
`;

interface AnimatedLogoProps {
  size?: number;
  className?: string;
}

export function AnimatedLogo({ size = 40, className = '' }: AnimatedLogoProps) {
  return (
    <div className={`smainer-logo-container ${className}`} style={{ width: size, height: size }}>
      <style>{styles}</style>
      <svg 
        width="100%" 
        height="100%" 
        viewBox="100 80 312 352" 
        fill="none" 
        xmlns="http://www.w3.org/2000/svg"
        style={{ overflow: 'visible' }}
      >
        {/* Official: 7 compute blocks in distributed S-formation */}
        
        {/* White block - top center wide */}
        <rect x="200" y="104" width="112" height="48" rx="8" fill="#FFFFFF" />
        
        {/* BLUE block 1 - top right */}
        <rect x="328" y="104" width="48" height="48" rx="8" fill="#3B82F6" className="smainer-logo-glow" />
        
        {/* White block - upper left */}
        <rect x="136" y="168" width="48" height="48" rx="8" fill="#FFFFFF" />
        
        {/* White block - center wide */}
        <rect x="200" y="232" width="112" height="48" rx="8" fill="#FFFFFF" />
        
        {/* White block - lower right */}
        <rect x="328" y="296" width="48" height="48" rx="8" fill="#FFFFFF" />
        
        {/* BLUE block 2 - bottom left */}
        <rect x="136" y="360" width="48" height="48" rx="8" fill="#3B82F6" className="smainer-logo-glow" />
        
        {/* White block - bottom center wide */}
        <rect x="200" y="360" width="112" height="48" rx="8" fill="#FFFFFF" />
      </svg>
    </div>
  );
}

export default AnimatedLogo;
