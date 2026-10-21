import type { ChromePage } from '../runtime/pages.ts';
import { evaluateInIsolatedWorld } from './isolated-world.ts';

/**
 * What the page's viewport shows, as a JPEG with one image pixel per CSS pixel.
 *
 * The page renders at the pixel density of the screen that views it (and of the page's
 * zoom), which may be twice the CSS size or more. A model reads the page at its CSS size,
 * where the image costs it a quarter as much; the agent acts on elements, not on image
 * coordinates.
 */
export async function captureViewport(page: ChromePage, quality = 80): Promise<Uint8Array> {
  const { frameTree } = await page.send('Page.getFrameTree');
  const [{ cssVisualViewport }, density] = await Promise.all([
    page.send('Page.getLayoutMetrics'),
    evaluateInIsolatedWorld(page, frameTree.frame.id, 'devicePixelRatio'),
  ]);
  const { data } = await page.send('Page.captureScreenshot', {
    format: 'jpeg',
    quality,
    clip: {
      x: cssVisualViewport.pageX,
      y: cssVisualViewport.pageY,
      width: cssVisualViewport.clientWidth,
      height: cssVisualViewport.clientHeight,
      // Chrome renders the clip at `scale` times the page's pixel density.
      scale: typeof density === 'number' && density > 0 ? 1 / density : 1,
    },
  });
  return Buffer.from(data, 'base64');
}
