import type { Variants, Transition } from 'framer-motion';

/** Standard spring for dialogs & panels */
export const springTransition: Transition = {
  type: 'spring',
  stiffness: 400,
  damping: 30,
};

/** Ease for subtle fades */
export const easeTransition: Transition = {
  duration: 0.15,
  ease: 'easeOut',
};

export const fadeIn: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

export const scaleIn: Variants = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.95 },
};

export const slideInRight: Variants = {
  initial: { opacity: 0, x: 40, width: 0 },
  animate: { opacity: 1, x: 0, width: 'auto' },
  exit: { opacity: 0, x: 40, width: 0 },
};

export const slideInUp: Variants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
};

export const staggerContainer: Variants = {
  animate: {
    transition: { staggerChildren: 0.03 },
  },
};

export const staggerItem: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
};
