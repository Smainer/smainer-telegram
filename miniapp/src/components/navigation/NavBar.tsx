import React from 'react';
import { NavigateFunction } from 'react-router-dom';
import { IconHome, IconCompute, IconStats } from '../ui/Icons';

interface NavBarProps {
  currentView: string;
  navigate: NavigateFunction;
}

export function NavBar({ currentView, navigate }: NavBarProps) {
  const tabs = [
    { id: 'home', label: 'Home', path: '/', Icon: IconHome },
    { id: 'chat', label: 'Compute', path: '/chat', Icon: IconCompute },
    { id: 'dashboard', label: 'Stats', path: '/dashboard', Icon: IconStats },
  ];

  return (
    <nav style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      background: 'rgba(9, 9, 11, 0.95)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      borderTop: '1px solid #27272A',
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      zIndex: 100
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'space-around',
        maxWidth: 448,
        margin: '0 auto',
        padding: '8px 16px 8px 16px'
      }}>
        {tabs.map(({ id, label, path, Icon }) => {
          const isActive = currentView === id;
          return (
            <button
              key={id}
              onClick={() => navigate(path)}
              style={{ 
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                padding: '8px 4px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                transition: 'transform 0.15s ease',
                WebkitTapHighlightColor: 'transparent'
              }}
            >
              <div style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon active={isActive} />
              </div>
              <span style={{ fontSize: 11, fontWeight: 500, lineHeight: 1, color: isActive ? '#3B82F6' : '#71717A' }}>
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}