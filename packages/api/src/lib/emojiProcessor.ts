import sharp from 'sharp';

export interface ProcessedEmoji {
  buffer: Buffer;
  content_type: string;
  is_animated: boolean;
  width: number;
  height: number;
  size_bytes: number;
}

const EMOJI_MAX_BYTES = 2 * 1024 * 1024; // 2MB
const EMOJI_MAX_DIMENSION = 256;

/**
 * Detect if a PNG buffer is actually an APNG (animated PNG).
 * Checks for the acTL chunk which is required by the APNG spec.
 */
function isApng(buffer: Buffer): boolean {
  // PNG signature: 8 bytes
  // Then chunks: 4 bytes length + 4 bytes type + data + 4 bytes CRC
  let offset = 8;
  while (offset < buffer.length - 8) {
    const chunkLength = buffer.readUInt32BE(offset);
    const chunkType = buffer.toString('ascii', offset + 4, offset + 8);
    if (chunkType === 'acTL') return true;
    if (chunkType === 'IDAT') return false; // acTL must come before IDAT
    offset += 12 + chunkLength; // 4 (length) + 4 (type) + data + 4 (CRC)
  }
  return false;
}

/**
 * Process an emoji image:
 * - Validate format (png, jpg, gif, webp - reject APNG)
 * - Static images: re-encode to WebP, max 256x256
 * - Animated GIF: keep as GIF, max 256x256
 * - Strip metadata by re-encoding
 * - Enforce 2MB max size
 */
export async function processEmoji(buffer: Buffer): Promise<ProcessedEmoji> {
  if (buffer.length > EMOJI_MAX_BYTES * 2) {
    throw new Error('File too large. Maximum size is 2MB');
  }

  const image = sharp(buffer, { animated: true });
  const metadata = await image.metadata();

  if (!metadata.format || !metadata.width || !metadata.height) {
    throw new Error('Invalid image: could not read format or dimensions');
  }

  const allowedFormats = ['jpeg', 'png', 'gif', 'webp'];
  if (!allowedFormats.includes(metadata.format)) {
    throw new Error(`Unsupported format: ${metadata.format}. Allowed: png, jpg, gif, webp`);
  }

  // Detect and reject APNG
  if (metadata.format === 'png' && isApng(buffer)) {
    throw new Error('APNG not supported; upload GIF instead');
  }

  const isAnimated = metadata.format === 'gif' && (metadata.pages ?? 1) > 1;

  let processed: Buffer;
  let contentType: string;

  if (isAnimated) {
    // Keep GIF format for animated images, resize if needed
    const needsResize =
      metadata.width > EMOJI_MAX_DIMENSION || metadata.height > EMOJI_MAX_DIMENSION;
    if (needsResize) {
      processed = await sharp(buffer, { animated: true })
        .resize(EMOJI_MAX_DIMENSION, EMOJI_MAX_DIMENSION, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .gif()
        .toBuffer();
    } else {
      // Re-encode to strip metadata
      processed = await sharp(buffer, { animated: true }).gif().toBuffer();
    }
    contentType = 'image/gif';
  } else {
    // Static images: convert to WebP
    const needsResize =
      metadata.width > EMOJI_MAX_DIMENSION || metadata.height > EMOJI_MAX_DIMENSION;
    const pipeline = sharp(buffer).resize(EMOJI_MAX_DIMENSION, EMOJI_MAX_DIMENSION, {
      fit: 'inside',
      withoutEnlargement: true,
    });

    if (needsResize) {
      processed = await pipeline.webp({ quality: 90 }).toBuffer();
    } else {
      processed = await sharp(buffer).webp({ quality: 90 }).toBuffer();
    }
    contentType = 'image/webp';
  }

  if (processed.length > EMOJI_MAX_BYTES) {
    throw new Error(
      `Processed image exceeds 2MB limit (${Math.round(processed.length / 1024)}KB)`
    );
  }

  // Get final dimensions
  const finalMeta = await sharp(processed).metadata();

  return {
    buffer: processed,
    content_type: contentType,
    is_animated: isAnimated,
    width: finalMeta.width || EMOJI_MAX_DIMENSION,
    height: finalMeta.height || EMOJI_MAX_DIMENSION,
    size_bytes: processed.length,
  };
}
