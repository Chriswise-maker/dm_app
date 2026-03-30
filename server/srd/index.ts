import path from 'path';
import { ContentPackLoader } from './content-pack';

export { ContentPackLoader } from './content-pack';
export { lookupByName, filterEntries, summarizeForLLM } from './srd-query';

let _loader: ContentPackLoader | null = null;

export function getSrdLoader(): ContentPackLoader {
  if (!_loader) {
    _loader = new ContentPackLoader();
    _loader.loadPack(path.resolve(__dirname, '../../data/srd-2014'));
    _loader.loadPack(path.resolve(__dirname, '../../data/custom'));
  }
  return _loader;
}
