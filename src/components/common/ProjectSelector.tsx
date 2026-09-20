import { useProject } from '@/contexts/ProjectContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

interface ProjectSelectorProps {
  className?: string;
  placeholder?: string;
}

export default function ProjectSelector({ className, placeholder = '选择项目' }: ProjectSelectorProps) {
  const { projects, selectedProjectId, setSelectedProjectId } = useProject();

  return (
    <Select value={selectedProjectId || ''} onValueChange={setSelectedProjectId}>
      <SelectTrigger className={cn('w-48', className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {projects.length === 0 && (
          <SelectItem value="no-projects" disabled>暂无项目，请先创建</SelectItem>
        )}
        {projects.map(p => (
          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
