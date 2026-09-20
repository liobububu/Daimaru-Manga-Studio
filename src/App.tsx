import React from 'react';
import IntersectObserver from '@/components/common/IntersectObserver';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import { ProjectProvider } from '@/contexts/ProjectContext';

import { routes } from './routes';

const App: React.FC = () => {
  return (
    <Router>
      <ProjectProvider>
        <IntersectObserver />
        <div className="flex flex-col min-h-screen">
          <main className="flex-grow">
            <Routes>
              {routes.map((route, index) => (
                <Route
                  key={index}
                  path={route.path}
                  element={route.element}
                />
              ))}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
        <Toaster />
      </ProjectProvider>
    </Router>
  );
};

export default App;
