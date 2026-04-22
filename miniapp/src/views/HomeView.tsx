import React from 'react';
import { NavigateFunction } from 'react-router-dom';
import { IconCompute, IconStats } from '../components/ui/Icons';

interface HomeViewProps {
  navigate: NavigateFunction;
  relayerAPI: any;
}

export function HomeView({ navigate, relayerAPI }: HomeViewProps) {
  const nodesOnline = relayerAPI.availableModels.length;
  
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 20px 112px 20px' }}>
      <div style={{ maxWidth: 448, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Header */}
        <div className="animate-in">
          <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#71717A', margin: 0, marginBottom: 4 }}>Dashboard</p>
          <h2 style={{ fontSize: 24, fontWeight: 700, color: '#E4E4E7', margin: 0 }}>Control Center</h2>
        </div>

        {/* Stats Row */}
        <div className="animate-in delay-1" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="glass" style={{ padding: 20, textAlign: 'center', borderRadius: 16 }}>
            <div style={{ fontSize: 36, fontWeight: 700, color: '#E4E4E7', marginBottom: 4 }}>{nodesOnline}</div>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#71717A' }}>Nodes Online</div>
          </div>
          <div className="glass" style={{ padding: 20, textAlign: 'center', borderRadius: 16 }}>
            <div style={{ fontSize: 36, fontWeight: 700, color: '#E4E4E7', marginBottom: 4 }}>0</div>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#71717A' }}>Tasks Run</div>
          </div>
        </div>

        {/* Primary CTA */}
        <button 
          onClick={() => navigate('/chat')}
          className="card-interactive animate-in delay-2"
          style={{ padding: 20, textAlign: 'left', borderLeft: '3px solid #3B82F6', width: '100%', borderRadius: 16 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <h3 style={{ fontSize: 18, fontWeight: 600, color: '#E4E4E7', marginBottom: 4 }}>Run Compute Task</h3>
              <p style={{ fontSize: 14, color: '#71717A', margin: 0 }}>Submit private inference to GPU nodes</p>
            </div>
            <div style={{ width: 48, height: 48, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#3B82F6' }}>
              <IconCompute active />
            </div>
          </div>
          {nodesOnline > 0 && (
            <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22C55E', boxShadow: '0 0 8px #22C55E' }} />
              <span style={{ fontSize: 14, color: '#22C55E' }}>{nodesOnline} node{nodesOnline !== 1 ? 's' : ''} ready</span>
            </div>
          )}
        </button>

        {/* Secondary Actions */}
        <div className="animate-in delay-3">
          <button
            onClick={() => navigate('/dashboard')}
            className="card-interactive"
            style={{ padding: 16, textAlign: 'left', borderRadius: 16, width: '100%' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#27272A' }}>
                <IconStats />
              </div>
              <div>
                <h4 style={{ fontWeight: 600, color: '#E4E4E7', marginBottom: 4 }}>Dashboard</h4>
                <p style={{ fontSize: 12, color: '#71717A', margin: 0 }}>Balance & status</p>
              </div>
            </div>
          </button>
        </div>

        {/* Network Status */}
        <div className="glass animate-in delay-4" style={{ padding: 16, borderRadius: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 8, height: 8, borderRadius: '50%',
                background: relayerAPI.isConnected ? '#22C55E' : '#EF4444',
                boxShadow: relayerAPI.isConnected ? '0 0 8px #22C55E' : 'none'
              }} />
              <span style={{ fontSize: 14, color: '#71717A' }}>
                {relayerAPI.isConnected ? 'Network Active' : 'Connecting...'}
              </span>
            </div>
            <span className="pill">Starknet L2</span>
          </div>
        </div>
      </div>
    </div>
  );
}