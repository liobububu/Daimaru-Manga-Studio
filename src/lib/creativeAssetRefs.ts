import type { Asset } from '@/types/types';

export type CreativeAssetCategory = 'character' | 'scene' | 'prop';

export interface CreativeAssetRef {
  token: string;
  asset: Asset;
  category: CreativeAssetCategory;
}

export function resolveCreativeAssetRefs(prompt: string, assets: Asset[]): CreativeAssetRef[] {
  const refs: CreativeAssetRef[] = [];
  const seen = new Set<string>();
  for (const asset of assets) {
    const category = asset.metadata?.category;
    if (category !== 'character' && category !== 'scene' && category !== 'prop') continue;
    const token = `@${asset.name}`;
    if (!prompt.includes(token) || seen.has(asset.id)) continue;
    seen.add(asset.id);
    refs.push({ token, asset, category });
  }
  return refs;
}

export function creativeAssetRole(category: CreativeAssetCategory) {
  if (category === 'character') return 'character_reference';
  if (category === 'scene') return 'scene_reference';
  return 'reference';
}

export function creativeAssetSuggestions(text: string, assets: Asset[]): Asset[] {
  const match = text.match(/@([^@\s，。！？、]*)$/);
  if (!match) return [];
  const keyword = match[1].toLowerCase();
  return assets
    .filter(asset => ['character', 'scene', 'prop'].includes(String(asset.metadata?.category)))
    .filter(asset => !keyword || asset.name.toLowerCase().includes(keyword))
    .slice(0, 8);
}

export function insertCreativeAssetToken(text: string, assetName: string) {
  return text.replace(/@([^@\s，。！？、]*)$/, `@${assetName} `);
}
