import { useFeaturesStore } from '@/common/store/features.store';
import type { Features } from '@/common/types/global';

export type FeatureFlag = keyof Omit<Features, 'node'>;

/** True only once the server has said the feature exists here. */
export const useFeatureFlag = (flag: FeatureFlag): boolean =>
  useFeaturesStore((state) => state.features?.[flag] ?? false);
