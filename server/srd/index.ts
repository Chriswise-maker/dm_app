import path from 'path';
import { ContentPackLoader } from './content-pack';

export { ContentPackLoader } from './content-pack';
export { lookupByName, filterEntries, summarizeForLLM } from './srd-query';
export { buildActorSheet, type CharacterBuildInput } from './character-builder';

let _loader: ContentPackLoader | null = null;

export function getSrdLoader(): ContentPackLoader {
  if (!_loader) {
    _loader = new ContentPackLoader();
    _loader.loadPack(path.resolve(import.meta.dirname, '../../data/srd-2014'));
    _loader.loadPack(path.resolve(import.meta.dirname, '../../data/custom'));
  }
  return _loader;
}
