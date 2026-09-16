import { Router } from 'wouter';
import { Home } from './ui/Home';

export function App() {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return (
    <Router base={base}>
      <Home />
    </Router>
  );
}
