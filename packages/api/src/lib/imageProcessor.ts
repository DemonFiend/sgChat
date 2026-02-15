/**
 * Image processing utilities for avatar uploads.
 * Uses Sharp for efficient image resizing and format conversion.
 */

import sharp from 'sharp';

export interface ProcessedImage {
  buffer: Buffer;
  width: number;
  height: number;
  format: string;
}

/**
 * Process an avatar image:
 * - Resize to fit within maxDimension (square crop from center)
 * - Convert to WebP for optimal compression
 * - Apply quality settings
 */
export async function processAvatarImage(
  buffer: Buffer,
  maxDimension: number,
  quality: number
): Promise<ProcessedImage> {
  const image = sharp(buffer);
  
  // Get original metadata for validation
  const metadata = await image.metadata();
  
  if (!metadata.width || !metadata.height) {
    throw new Error('Invalid image: could not read dimensions');
  }
  
  // Resize to square, cropping from center if needed
  const processed = await image
    .resize(maxDimension, maxDimension, {
      fit: 'cover',
      position: 'center',
    })
    .webp({ quality })
    .toBuffer();
  
  return {
    buffer: processed,
    width: maxDimension,
    height: maxDimension,
    format: 'webp',
  };
}

/**
 * Validate that a buffer is a valid image.
 * Returns metadata if valid, throws if not.
 */
export async function validateImage(buffer: Buffer): Promise<sharp.Metadata> {
  try {
    const image = sharp(buffer);
    const metadata = await image.metadata();
    
    if (!metadata.format) {
      throw new Error('Unknown image format');
    }
    
    const allowedFormats = ['jpeg', 'png', 'gif', 'webp'];
    if (!allowedFormats.includes(metadata.format)) {
      throw new Error(`Unsupported image format: ${metadata.format}. Allowed: ${allowedFormats.join(', ')}`);
    }
    
    return metadata;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Failed to process image');
  }
}
