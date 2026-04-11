import { showToast } from '../components/Toast.js';

export async function copyText(text: string, successMsg: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMsg);
  } catch {
    showToast('Failed to copy');
  }
}
