import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import AuthPortal from './auth/AuthPortal';
import { AuthProvider } from './auth/AuthProvider';
import { usePathname } from './auth/navigation';
import './styles.css';

function AppRouter() {
  const pathname = usePathname();
  return <>
    <div className="game-layer" aria-hidden={pathname !== '/'} inert={pathname !== '/'}>
      <App />
    </div>
    {pathname !== '/' && <AuthPortal path={pathname} />}
  </>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider><AppRouter /></AuthProvider>
  </React.StrictMode>,
);
