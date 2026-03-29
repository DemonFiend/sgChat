/** Noise suppression modes supported across desktop and web clients */
export type NoiseSuppressionMode = 'off' | 'native' | 'nsnet2' | 'deepfilter';

export const NOISE_SUPPRESSION_MODES = ['off', 'native', 'nsnet2', 'deepfilter'] as const;

/** Modes available in web browsers (no DeepFilterNet — desktop only) */
export const WEB_NOISE_MODES = ['off', 'native', 'nsnet2'] as const;
export type WebNoiseSuppressionMode = (typeof WEB_NOISE_MODES)[number];

export const DEFAULT_NOISE_SUPPRESSION_MODE: NoiseSuppressionMode = 'native';
export const DEFAULT_NOISE_AGGRESSIVENESS = 0.5;
export const MIN_NOISE_AGGRESSIVENESS = 0.0;
export const MAX_NOISE_AGGRESSIVENESS = 1.0;
