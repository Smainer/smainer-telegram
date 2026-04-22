import React from 'react';
import type { ConnectedWallet } from '../types';

interface DashboardViewProps {
  connectedWallet: ConnectedWallet;
  relayerAPI: any;
  onDisconnect: () => void;
  isInTelegram: boolean;
}

export function DashboardView({
  connectedWallet,
  relayerAPI,
  onDisconnect,
  isInTelegram,
}: DashboardViewProps) {
  const nodes = relayerAPI.availableModels || [];
  const nodesOnline = nodes.length;
  
  return (
    <div style={{ 
      flex: 1, 
      overflowY: 'auto', 
      background: 'var(--void)',
    }}>
      {/* Content container with proper padding */}
      <div style={{ 
        padding: '24px 20px 120px 20px',
        maxWidth: 480,
        margin: '0 auto',
      }}>
        {/* ─── Header Section ─── */}
        <div className="animate-in" style={{ marginBottom: 24 }}>
          <p style={{ 
            fontSize: 12, 
            fontWeight: 600, 
            letterSpacing: '0.1em', 
            textTransform: 'uppercase', 
            color: 'var(--text-hint)', 
            margin: 0,
            marginBottom: 6
          }}>DASHBOARD</p>
          <h2 style={{ 
            fontSize: 26, 
            fontWeight: 700, 
            color: 'var(--text-primary)', 
            margin: 0,
            letterSpacing: '-0.02em'
          }}>Private Compute</h2>
        </div>

        {/* ─── Status Cards Row ─── */}
        <div className="animate-in delay-1" style={{ 
          display: 'grid', 
          gridTemplateColumns: '1fr 1fr', 
          gap: 12,
          marginBottom: 20
        }}>
          <div className="glass" style={{ 
            padding: 20, 
            borderRadius: 16,
            textAlign: 'center'
          }}>
            <p style={{ 
              fontSize: 32, 
              fontWeight: 700, 
              color: nodesOnline > 0 ? 'var(--success)' : 'var(--text-muted)', 
              margin: 0,
              marginBottom: 4
            }}>{nodesOnline}</p>
            <p style={{ 
              fontSize: 12, 
              fontWeight: 600,
              color: 'var(--text-hint)', 
              textTransform: 'uppercase', 
              letterSpacing: '0.08em', 
              margin: 0 
            }}>Nodes Online</p>
          </div>
          <div className="glass" style={{ 
            padding: 20, 
            borderRadius: 16,
            textAlign: 'center'
          }}>
            <p style={{ 
              fontSize: 32, 
              fontWeight: 700, 
              color: 'var(--text-secondary)', 
              margin: 0,
              marginBottom: 4
            }}>0</p>
            <p style={{ 
              fontSize: 12, 
              fontWeight: 600,
              color: 'var(--text-hint)', 
              textTransform: 'uppercase', 
              letterSpacing: '0.08em', 
              margin: 0 
            }}>Tasks Run</p>
          </div>
        </div>

        {/* ─── GPU Nodes Section ─── */}
        <div className="animate-in delay-2" style={{ marginBottom: 20 }}>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            marginBottom: 14
          }}>
            <h3 style={{ 
              fontSize: 15, 
              fontWeight: 600, 
              color: 'var(--text-secondary)', 
              margin: 0 
            }}>GPU Nodes</h3>
            <span style={{
              fontSize: 12,
              fontWeight: 500,
              color: nodesOnline > 0 ? 'var(--success)' : 'var(--text-hint)',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}>
              <span style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: nodesOnline > 0 ? 'var(--success)' : 'var(--text-hint)',
                boxShadow: nodesOnline > 0 ? '0 0 8px var(--success)' : 'none'
              }} />
              {nodesOnline > 0 ? `${nodesOnline} available` : 'None available'}
            </span>
          </div>
          
          {/* GPU Node Cards */}
          {nodesOnline > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {nodes.map((node: any, index: number) => (
                <div 
                  key={node.node_id || index} 
                  className="glass"
                  style={{ 
                    padding: 16,
                    borderRadius: 16,
                    borderLeft: '3px solid var(--success)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* GPU Icon + Name */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                        <div style={{
                          width: 36,
                          height: 36,
                          borderRadius: 10,
                          background: 'rgba(34, 197, 94, 0.12)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0
                        }}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="4" y="4" width="16" height="16" rx="2" />
                            <rect x="9" y="9" width="6" height="6" />
                            <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
                          </svg>
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <p style={{ 
                            fontSize: 15, 
                            fontWeight: 600, 
                            color: 'var(--text-primary)', 
                            margin: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}>
                            {node.gpu || 'GPU Node'}
                          </p>
                          <p style={{ 
                            fontSize: 12, 
                            color: 'var(--text-hint)', 
                            margin: 0,
                            fontFamily: 'monospace'
                          }}>
                            {node.node_id?.slice(0, 8) || '...'}
                          </p>
                        </div>
                      </div>
                      {/* Specs */}
                      <div style={{ display: 'flex', gap: 16 }}>
                        <div>
                          <p style={{ fontSize: 11, color: 'var(--text-hint)', margin: 0, marginBottom: 2 }}>RAM</p>
                          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', margin: 0 }}>{node.ram_gb || '?'} GB</p>
                        </div>
                        <div>
                          <p style={{ fontSize: 11, color: 'var(--text-hint)', margin: 0, marginBottom: 2 }}>Tiers</p>
                          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', margin: 0 }}>
                            {node.supported_tiers?.join(', ') || 'small'}
                          </p>
                        </div>
                      </div>
                    </div>
                    {/* Status Badge */}
                    <span style={{
                      padding: '6px 10px',
                      borderRadius: 8,
                      background: 'rgba(34, 197, 94, 0.12)',
                      color: 'var(--success)',
                      fontSize: 12,
                      fontWeight: 600,
                      flexShrink: 0
                    }}>
                      Ready
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* Empty State */
            <div className="glass" style={{ 
              padding: 32, 
              borderRadius: 16, 
              textAlign: 'center' 
            }}>
              <div style={{ 
                width: 56, 
                height: 56, 
                borderRadius: 14, 
                background: 'var(--surface-glass)', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                margin: '0 auto 16px auto'
              }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text-hint)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                  <path d="M9 9h6v6H9z" />
                  <path d="M4 9h1M4 15h1M19 9h1M19 15h1M9 4v1M15 4v1M9 19v1M15 19v1" />
                </svg>
              </div>
              <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                No GPU nodes online
              </p>
              <p style={{ fontSize: 14, color: 'var(--text-hint)', margin: 0, lineHeight: 1.5 }}>
                GPU providers will appear here when they connect to the network.
              </p>
            </div>
          )}
        </div>

        {/* ─── Wallet Balance Card ─── */}
        <div className="glass animate-in delay-3" style={{ 
          padding: 20, 
          borderRadius: 16,
          marginBottom: 16
        }}>
          <p style={{ 
            fontSize: 12, 
            fontWeight: 600, 
            letterSpacing: '0.08em', 
            textTransform: 'uppercase', 
            color: 'var(--text-hint)', 
            margin: 0,
            marginBottom: 14
          }}>Wallet Balance</p>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 36, fontWeight: 700, color: 'var(--text-primary)' }}>
              {connectedWallet.balance_strk || '0'}
            </span>
            <span style={{ fontSize: 16, color: 'var(--text-hint)', fontWeight: 500 }}>STRK</span>
          </div>
          <div style={{ 
            paddingTop: 14, 
            borderTop: '1px solid var(--border-subtle)' 
          }}>
            <p style={{ 
              fontSize: 12, 
              color: 'var(--text-hint)', 
              fontFamily: 'monospace', 
              wordBreak: 'break-all', 
              margin: 0,
              lineHeight: 1.4
            }}>
              {connectedWallet.address}
            </p>
          </div>
        </div>

        {/* ─── Network Status Card ─── */}
        <div className="glass animate-in delay-4" style={{ 
          padding: 20, 
          borderRadius: 16,
          marginBottom: 16
        }}>
          <p style={{ 
            fontSize: 12, 
            fontWeight: 600, 
            letterSpacing: '0.08em', 
            textTransform: 'uppercase', 
            color: 'var(--text-hint)', 
            margin: 0,
            marginBottom: 16
          }}>Network Status</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>Relayer</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ 
                  fontSize: 14, 
                  fontWeight: 500, 
                  color: relayerAPI.isConnected ? 'var(--success)' : 'var(--error)' 
                }}>
                  {relayerAPI.isConnected ? 'Connected' : 'Offline'}
                </span>
                <div style={{ 
                  width: 8, 
                  height: 8, 
                  borderRadius: '50%', 
                  backgroundColor: relayerAPI.isConnected ? 'var(--success)' : 'var(--error)',
                  boxShadow: relayerAPI.isConnected ? '0 0 8px var(--success)' : 'none'
                }} />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>Compute Nodes</span>
              <span style={{ fontSize: 14, color: 'var(--text-secondary)', fontWeight: 600 }}>{nodesOnline}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>Chain</span>
              <span className="pill">Starknet L2</span>
            </div>
          </div>
        </div>

        {/* ─── Privacy Info Card ─── */}
        <div className="glass animate-in delay-5" style={{ 
          padding: 18, 
          borderRadius: 16,
          marginBottom: 20,
          background: 'rgba(99, 102, 241, 0.06)',
          borderColor: 'rgba(99, 102, 241, 0.2)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ 
              width: 42, 
              height: 42, 
              borderRadius: 12, 
              background: 'rgba(99, 102, 241, 0.15)', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              flexShrink: 0
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6366F1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', margin: 0, marginBottom: 4 }}>
                Private Compute
              </p>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, lineHeight: 1.4 }}>
                Your inference runs on decentralized GPU nodes. Only you see the results.
              </p>
            </div>
          </div>
        </div>

        {/* ─── Disconnect / Unlink Button ─── */}
        <button
          onClick={onDisconnect}
          className="animate-in delay-6"
          style={{
            width: '100%',
            padding: '14px 20px',
            background: 'transparent',
            border: '1px solid var(--border-subtle)',
            borderRadius: 12,
            color: 'var(--error)',
            fontSize: 15,
            fontWeight: 500,
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
        >
          {isInTelegram ? 'Disconnect & Unlink Wallet' : 'Disconnect Wallet'}
        </button>
      </div>
    </div>
  );
}