import { NavLink } from 'react-router-dom';

const links = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/users', label: 'Users' },
  { to: '/terminal', label: 'Terminal' },
  { to: '/settings', label: 'Settings' },
];

export default function Sidebar({ wgOnline, appVersion }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="logo-block">
          <div className="logo-icon">⬢</div>
          <div>
            <div className="logo-title">WireGate</div>
            <div className="logo-sub">
              <span className={`dot ${wgOnline ? 'dot-green' : 'dot-red'}`} />
              {wgOnline ? 'WireGuard online' : 'WireGuard offline'}
            </div>
          </div>
        </div>

        <nav className="nav-links">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="sidebar-footer">
        <div>{appVersion || 'v1.0.0'}</div>
        <a href="https://github.com" target="_blank" rel="noreferrer">
          GitHub
        </a>
      </div>
    </aside>
  );
}
