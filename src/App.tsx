import { Router } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';
import { Home } from './ui/Home';

export function App() {
  return (
    <Router hook={useHashLocation}>
      <Home />
    </Router>
  );
}
