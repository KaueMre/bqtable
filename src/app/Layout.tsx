import { NavLink, Outlet } from 'react-router';

export function Layout() {
  return (
    <div className="layout">
      <nav className="layout-nav">
        <NavLink to="/" end>
          Início
        </NavLink>
        <NavLink to="/jogar">Jogar</NavLink>
        <NavLink to="/sandbox">Sandbox</NavLink>
      </nav>
      <main className="layout-main">
        <Outlet />
      </main>
    </div>
  );
}
