const MAX_SIZE = 1600;

/** Reads an image file as a data URL, downscaling large photos to keep the workspace small. */
export function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const src = reader.result as string;
      if (/gif|svg/.test(file.type)) return resolve(src);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, MAX_SIZE / Math.max(img.width, img.height));
        if (scale === 1 && file.size < 1_500_000) return resolve(src);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.86));
      };
      img.onerror = () => resolve(src);
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}

/** Opens the file picker and resolves with the chosen images as data URLs. */
export function pickImages(multiple = true): Promise<string[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = multiple;
    input.onchange = async () => resolve(await Promise.all([...(input.files ?? [])].map(readImage)));
    input.click();
  });
}
