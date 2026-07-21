export const IMAGE_ZOOM_MIN = 0.5;
export const IMAGE_ZOOM_MAX = 3;
export const IMAGE_ZOOM_STEP = 0.25;

export type ImageZoomAction = 'in' | 'out' | 'reset';

export function imageZoomAfter(current: number, action: ImageZoomAction): number {
  if (action === 'reset') return 1;
  const next = current + (action === 'in' ? IMAGE_ZOOM_STEP : -IMAGE_ZOOM_STEP);
  return Math.min(IMAGE_ZOOM_MAX, Math.max(IMAGE_ZOOM_MIN, next));
}

export function imageViewerKeyAction(key: string): ImageZoomAction | null {
  if (key === '+' || key === '=') return 'in';
  if (key === '-' || key === '_') return 'out';
  if (key === '0') return 'reset';
  return null;
}

export function imageZoomLabel(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}
