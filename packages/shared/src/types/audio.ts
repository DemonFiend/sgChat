/** Noise cancellation modes supported across desktop and web clients */
export type NoiseCancellationMode = 'off' | 'native' | 'nsnet2' | 'deepfilter';

export const NOISE_CANCELLATION_MODES = ['off', 'native', 'nsnet2', 'deepfilter'] as const;

/** Modes available in web browsers (no DeepFilterNet — desktop only) */
export const WEB_NOISE_MODES = ['off', 'native', 'nsnet2'] as const;
export type WebNoiseCancellationMode = (typeof WEB_NOISE_MODES)[number];

export const DEFAULT_NOISE_CANCELLATION_MODE: NoiseCancellationMode = 'off';
export const DEFAULT_NS_AGGRESSIVENESS = 0.5;
export const MIN_NS_AGGRESSIVENESS = 0.0;
export const MAX_NS_AGGRESSIVENESS = 1.0;
