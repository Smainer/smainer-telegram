import React from 'react';

/**
 * AnimatedLogo - Drop-in replacement for SmainerLogo with 3D spin-to-front animation
 * on the 2 blue accent squares.
 * 
 * Usage: <AnimatedLogo size={64} />
 * 
 * The animation uses CSS 3D transforms to create a subtle spin-and-float effect
 * on only the blue squares while keeping the white blocks static.
 */

const styles = `
@keyframes spinFloat {
  0% {
    transform: perspective(400px) rotateX(0deg);
  }
  25% {
    transform: perspective(400px) rotateX(90deg);
  }
  50% {
    transform: perspective(400px) rotateX(180deg);
  }
  75% {
    transform: perspective(400px) rotateX(270deg);
  }
  100% {
    transform: perspective(400px) rotateX(360deg);
  }
}

@keyframes spinFloatDelayed {
  0% {
    transform: perspective(400px) rotateX(180deg);
  }
  25% {
    transform: perspective(400px) rotateX(270deg);
  }
  50% {
    transform: perspective(400px) rotateX(360deg);
  }
  75% {
    transform: perspective(400px) rotateX(450deg);
  }
  100% {
    transform: perspective(400px) rotateX(540deg);
  }
}

.smainer-logo-blue-block-1 {
  animation: spinFloat 4s ease-in-out infinite;
  transform-origin: center center;
  transform-style: preserve-3d;
  backface-visibility: visible;
}

.smainer-logo-blue-block-2 {
  animation: spinFloatDelayed 4s ease-in-out infinite;
  animation-delay: -2s;
  transform-origin: center center;
  transform-style: preserve-3d;
  backface-visibility: visible;
}
`;

interface AnimatedLogoProps {
  size?: number;
  className?: string;
}

export function AnimatedLogo({ size = 40, className = '' }: AnimatedLogoProps) {
  return (
    <>
      <style>{styles}</style>
      <svg 
        width={size} 
        height={size} 
        viewBox="100 80 312 352" 
        fill="none" 
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        style={{ overflow: 'visible' }}
      >
        {/* Official: 7 compute blocks in distributed S-formation */}
        
        {/* White block - top center wide */}
        <rect x="200" y="104" width="112" height="48" rx="8" fill="#FFFFFF" />
        
        {/* BLUE block 1 - top right (animated) */}
        <g className="smainer-logo-blue-block-1">
          <rect x="328" y="104" width="48" height="48" rx="8" fill="#3B82F6" />
        </g>
        
        {/* White block - upper left */}
        <rect x="136" y="168" width="48" height="48" rx="8" fill="#FFFFFF" />
        
        {/* White block - center wide */}
        <rect x="200" y="232" width="112" height="48" rx="8" fill="#FFFFFF" />
        
        {/* White block - lower right */}
        <rect x="328" y="296" width="48" height="48" rx="8" fill="#FFFFFF" />
        
        {/* BLUE block 2 - bottom left (animated) */}
        <g className="smainer-logo-blue-block-2">
          <rect x="136" y="360" width="48" height="48" rx="8" fill="#3B82F6" />
        </g>
        
        {/* White block - bottom center wide */}
        <rect x="200" y="360" width="112" height="48" rx="8" fill="#FFFFFF" />
      </svg>
    </>
  );
}

export default AnimatedLogo;
