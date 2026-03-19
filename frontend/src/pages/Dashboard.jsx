import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import Header from '../components/Header';
import StatCard from '../components/StatCard';
import { useToast } from '../components/Toast';

function formatUptime(seconds = 0) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}

function formatMemory(total, free) {
  const used = Math.max(total - free, 0);
  const toGb = (value) => (value / 1024 / 1024 / 1024).toFixed(1);
  return `${toGb(used)} / ${toGb(total)} GB`;
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return 'Never';
  const diffSeconds = Math.max(1, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)} minutes ago`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)} hours ago`;
  return `${Math.floor(diffSeconds / 86400)} days ago`;
}

function truncateMiddle(value = '') {
  if (!value) return 'Unavailable';
  if (value.length <= 20) return value;
  return `${value.slice(0, 8)}...${value.slice(-8)}`;
}

export default function Dashboard({ onStatusChange }) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState('');
  const [systemInfo, setSystemInfo] = useState(null);
  const [wgStatus, setWgStatus] = useState(null);
  const [users, setUsers] = useState([]);
  const [terminalOutput, setTerminalOutput] = useState('Ready.');

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
    }

    try {
      const [system, status, userList] = await Promise.all([api.system(), api.wgStatus(), api.getUsers()]);
      setSystemInfo(system);
      setWgStatus(status);
      setUsers(userList);
      onStatusChange?.(status);
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [onStatusChange, showToast]);

  useEffect(() => {
    load();
    const interval = window.setInterval(() => load({ silent: true }), 15000);
    return () => window.clearInterval(interval);
  }, [load]);

  const handleControl = async (action) => {
    setBusyAction(action);
    setTerminalOutput(`$ wg-quick ${action.toLowerCase() === 'restart' ? 'down/up' : action.toLowerCase()} ${wgStatus?.interface || 'wg0'}\n`);
    try {
      await new Promise((resolve, reject) => {
        api.streamWireguardAction(action, {
          onChunk: (chunk) => {
            setTerminalOutput((current) => `${current}${chunk}`);
          },
          onEnd: resolve,
          onError: reject,
        });
      });

      showToast(`WireGuard ${action.toLowerCase()} complete`, 'success');
      await load({ silent: true });
    } catch (error) {
      setTerminalOutput((current) => `${current}\n[error] ${error.message}`);
      showToast(error.message, 'error');
    } finally {
      setBusyAction('');
    }
  };

  const stats = useMemo(() => {
    const connected = users.filter((user) => user.connected).length;
    return [
      { title: 'Users', value: users.length, hint: 'Provisioned WireGuard clients', tone: 'cyan' },
      { title: 'Connected', value: connected, hint: 'Peers active in the last 3 minutes', tone: 'green' },
      {
        title: 'Server uptime',
        value: systemInfo ? formatUptime(systemInfo.uptime) : '--',
        hint: systemInfo ? `Host ${systemInfo.hostname}` : 'Waiting for telemetry',
      },
      {
        title: 'Memory',
        value: systemInfo ? formatMemory(systemInfo.memTotal, systemInfo.memFree) : '--',
        hint: systemInfo ? `Load ${systemInfo.loadAvg.join(' / ')}` : 'Waiting for telemetry',
        tone: 'amber',
      },
    ];
  }, [systemInfo, users]);

  return (
    <div className="page">
      <Header title="Dashboard" subtitle="Live WireGuard status and connected peers." />

      {loading && !wgStatus ? <div className="card loading-card">Loading dashboard…</div> : null}

      <div className="stat-grid">
        {stats.map((item) => (
          <StatCard key={item.title} {...item} />
        ))}
      </div>

      <div className="card section-card">
        <div className="section-head">
          <div>
            <h2>WireGuard status</h2>
            <p className="page-sub">Interface controls and last command output.</p>
          </div>
          <span className={`badge ${wgStatus?.running ? 'badge-online' : 'badge-offline'}`}>
            {wgStatus?.running ? 'Running' : 'Stopped'}
          </span>
        </div>

        <div className="status-grid">
          <div className="status-item">
            <span className="meta-label">Interface</span>
            <strong>{wgStatus?.interface || '--'}</strong>
          </div>
          <div className="status-item">
            <span className="meta-label">Public key</span>
            <strong className="mono-text">{truncateMiddle(wgStatus?.publicKey)}</strong>
          </div>
          <div className="status-item">
            <span className="meta-label">Listen port</span>
            <strong>{wgStatus?.listenPort || '--'}</strong>
          </div>
        </div>

        <div className="button-row">
          <button className="btn btn-success" type="button" disabled={!!busyAction} onClick={() => handleControl('Start')}>
            Start
          </button>
          <button className="btn btn-danger" type="button" disabled={!!busyAction} onClick={() => handleControl('Stop')}>
            Stop
          </button>
          <button className="btn btn-amber" type="button" disabled={!!busyAction} onClick={() => handleControl('Restart')}>
            Restart
          </button>
        </div>

        <pre className="terminal">{terminalOutput}</pre>
      </div>

      <div className="card section-card">
        <div className="section-head">
          <div>
            <h2>Connected peers</h2>
            <p className="page-sub">Merged user records with live peer state.</p>
          </div>
        </div>

        {users.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>IP address</th>
                  <th>Status</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.publicKey}>
                    <td>
                      <div className="table-name">{user.name}</div>
                      <div className="muted-text">{user.email || 'No email'}</div>
                    </td>
                    <td className="mono-text">{user.ip}</td>
                    <td>
                      <span className={`badge ${user.connected ? 'badge-online' : 'badge-offline'}`}>
                        {user.connected ? 'Online' : 'Offline'}
                      </span>
                    </td>
                    <td>{formatRelativeTime(user.latestHandshake)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <div className="empty-icon">◇</div>
            <p>No users yet. Create one from the Users page.</p>
          </div>
        )}
      </div>
    </div>
  );
}
