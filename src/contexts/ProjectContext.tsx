import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import type { Project } from '@/types/types';
import { getProjects } from '@/services/api';

interface ProjectContextType {
  projects: Project[];
  selectedProjectId: string | null;
  setSelectedProjectId: (id: string | null) => void;
  refreshProjects: () => Promise<void>;
  loading: boolean;
}

const ProjectContext = createContext<ProjectContextType>({
  projects: [],
  selectedProjectId: null,
  setSelectedProjectId: () => {},
  refreshProjects: async () => {},
  loading: false,
});

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(() =>
    localStorage.getItem('selectedProjectId'),
  );
  const [loading, setLoading] = useState(false);

  const refreshProjects = async () => {
    setLoading(true);
    try {
      const data = await getProjects();
      setProjects(data);
    } catch {
      // 静默失败
    } finally {
      setLoading(false);
    }
  };

  const handleSetProjectId = (id: string | null) => {
    setSelectedProjectId(id);
    if (id) localStorage.setItem('selectedProjectId', id);
    else localStorage.removeItem('selectedProjectId');
  };

  useEffect(() => {
    refreshProjects();
  }, []);

  return (
    <ProjectContext.Provider value={{ projects, selectedProjectId, setSelectedProjectId: handleSetProjectId, refreshProjects, loading }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  return useContext(ProjectContext);
}
