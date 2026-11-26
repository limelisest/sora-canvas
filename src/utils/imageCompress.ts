function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`读取文件 ${file.name} 失败`));
    reader.readAsDataURL(file);
  });
}

/**
 * Resize an image on an offscreen canvas so its longer edge is at most `maxSide`
 * and encode as WebP (preserving animated GIFs as-is).
 */
export async function compressImageFileToDataUrl(
  file: File,
  maxSide = 1600
): Promise<string> {
  if (file.type === 'image/gif') {
    return fileToDataUrl(file);
  }

  let width = 0;
  let height = 0;
  let bitmap: ImageBitmap | null = null;
  let imgEl: HTMLImageElement | null = null;
  let objectUrl: string | null = null;

  try {
    if (typeof createImageBitmap === 'function') {
      try {
        bitmap = await createImageBitmap(file);
        width = bitmap.width;
        height = bitmap.height;
      } catch {
        bitmap = null;
      }
    }

    if (!bitmap) {
      objectUrl = URL.createObjectURL(file);
      imgEl = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`解码图片 ${file.name} 失败`));
        img.src = objectUrl!;
      });
      width = imgEl.naturalWidth || imgEl.width;
      height = imgEl.naturalHeight || imgEl.height;
    }

    if (!width || !height) {
      return fileToDataUrl(file);
    }

    const longSide = Math.max(width, height);
    const scale = longSide > maxSide ? maxSide / longSide : 1;
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return fileToDataUrl(file);
    }

    if (bitmap) {
      ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    } else if (imgEl) {
      ctx.drawImage(imgEl, 0, 0, targetW, targetH);
    }

    const webpUrl = canvas.toDataURL('image/webp', 0.84);
    if (webpUrl.startsWith('data:image/webp')) {
      return webpUrl;
    }
    return fileToDataUrl(file);
  } catch {
    return fileToDataUrl(file);
  } finally {
    bitmap?.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}
