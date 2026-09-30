import { useFeaturesStore } from '@/common/store/features.store';
import type { BoardEngine, Features } from '@/common/types/global';

/** The on/off flags; `node` and `defaultEngine` carry values rather than yes/no. */
export type FeatureFlag = keyof Omit<Features, 'node' | 'defaultEngine'>;

/** True only once the server has said the feature exists here. */
export const useFeatureFlag = (flag: FeatureFlag): boolean =>
  useFeaturesStore((state) => Boolean(state.features?.[flag]));

/** The engine a new board gets unless its creator picks one. Raster until the server says. */
export const useDefaultEngine = (): BoardEngine =>
  useFeaturesStore((state) => state.features?.defaultEngine ?? 'raster');
