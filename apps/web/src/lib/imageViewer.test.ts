import { describe, expect, it } from 'vitest';
import {
  IMAGE_ZOOM_MAX,
  IMAGE_ZOOM_MIN,
  clampImageZoom,
  imageViewerKeyAction,
  imageZoomAfter,
  imageZoomLabel,
} from './imageViewer.js';

describe('image viewer zoom', () => {
  it('steps in either direction and resets', () => {
    expect(imageZoomAfter(1, 'in')).toBe(1.25);
    expect(imageZoomAfter(1, 'out')).toBe(0.75);
    expect(imageZoomAfter(2.5, 'reset')).toBe(1);
  });

  it('clamps zoom to the supported range', () => {
    expect(imageZoomAfter(IMAGE_ZOOM_MAX, 'in')).toBe(IMAGE_ZOOM_MAX);
    expect(imageZoomAfter(IMAGE_ZOOM_MIN, 'out')).toBe(IMAGE_ZOOM_MIN);
    expect(clampImageZoom(7)).toBe(IMAGE_ZOOM_MAX);
    expect(clampImageZoom(0.1)).toBe(IMAGE_ZOOM_MIN);
    expect(clampImageZoom(1.42)).toBe(1.42);
  });

  it('maps discoverable keyboard shortcuts', () => {
    expect(imageViewerKeyAction('+')).toBe('in');
    expect(imageViewerKeyAction('=')).toBe('in');
    expect(imageViewerKeyAction('-')).toBe('out');
    expect(imageViewerKeyAction('0')).toBe('reset');
    expect(imageViewerKeyAction('Escape')).toBeNull();
    expect(imageZoomLabel(1.25)).toBe('125%');
  });
});
