import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import Play from './pages/Play';

const Learn = lazy(() => import('./pages/Learn'));
const Review = lazy(() => import('./pages/Review'));
const GameAnalyzer = lazy(() => import('./pages/GameAnalyzer'));
const Insights = lazy(() => import('./pages/Insights'));
const Train = lazy(() => import('./pages/Train'));
const Openings = lazy(() => import('./pages/Openings'));
const Models = lazy(() => import('./pages/Models'));
const Settings = lazy(() => import('./pages/Settings'));

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/play" element={<Play />} />
        <Route path="/learn" element={<Learn />} />
        <Route path="/review" element={<Review />} />
        <Route path="/review/:id" element={<GameAnalyzer />} />
        <Route path="/insights" element={<Insights />} />
        <Route path="/train" element={<Train />} />
        <Route path="/openings" element={<Openings />} />
        <Route path="/models" element={<Models />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export function PageFallback() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-slate-500">Loading…</div>} />
  );
}
