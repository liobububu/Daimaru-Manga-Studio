import { useState, useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getModelCatalog, getFunctionModelBindings } from '@/services/api';
import type { ModelCatalog, FunctionKey, ModelCapability } from '@/types/types';
import { cn } from '@/lib/utils';

interface ModelSelectorProps {
  functionKey?: FunctionKey;
  requiredCapability?: ModelCapability;
  value: string;
  onChange: (modelId: string, apiConfigId: string) => void;
  className?: string;
  placeholder?: string;
}

export default function ModelSelector({ functionKey, requiredCapability, value, onChange, className, placeholder = '选择模型' }: ModelSelectorProps) {
  const [models, setModels] = useState<ModelCatalog[]>([]);

  useEffect(() => {
    loadModels();
  }, [functionKey, requiredCapability]);

  async function loadModels() {
    try {
      const allModels = await getModelCatalog();
      let filtered = allModels.filter(m => m.enabled);
      if (requiredCapability) {
        filtered = filtered.filter(m => m.capabilities.includes(requiredCapability));
      } else if (functionKey) {
        // 加载功能绑定的默认模型
        const bindings = await getFunctionModelBindings();
        const binding = bindings.find(b => b.function_key === functionKey);
        if (binding?.model_catalog_id) {
          // 预选默认模型
          const defaultModel = filtered.find(m => m.id === binding.model_catalog_id);
          if (defaultModel && !value) {
            onChange(defaultModel.id, defaultModel.api_config_id);
          }
        }
      }
      setModels(filtered);
    } catch {
      //
    }
  }

  return (
    <Select
      value={value || ''}
      onValueChange={(v) => {
        const model = models.find(m => m.id === v);
        if (model) onChange(model.id, model.api_config_id);
      }}
    >
      <SelectTrigger className={cn(className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {models.length === 0 && (
          <SelectItem value="no-models" disabled>请先在模型配置中添加模型</SelectItem>
        )}
        {models.map(m => (
          <SelectItem key={m.id} value={m.id}>
            {m.display_name || m.model_id}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
