import { useEffect, useRef } from 'react';

type Rect = [sx: number, sy: number, w: number, h: number];

interface Part {
  base: Rect;
  overlay?: Rect;
  /** where on the 16×32 front view (in skin pixels) */
  at: [number, number];
  /** 64×32 skins have no left limbs: mirror the right ones */
  mirrorOf?: Rect;
}

function frontParts(slim: boolean, legacy: boolean): Part[] {
  const armW = slim ? 3 : 4;
  const rightArm: Rect = [44, 20, armW, 12];
  const rightLeg: Rect = [4, 20, 4, 12];
  return [
    { base: [8, 8, 8, 8], overlay: [40, 8, 8, 8], at: [4, 0] },
    { base: [20, 20, 8, 12], overlay: legacy ? undefined : [20, 36, 8, 12], at: [4, 8] },
    { base: rightArm, overlay: legacy ? undefined : [44, 36, armW, 12], at: [4 - armW, 8] },
    legacy
      ? { base: rightArm, mirrorOf: rightArm, at: [12, 8] }
      : { base: [36, 52, armW, 12], overlay: [52, 52, armW, 12], at: [12, 8] },
    { base: rightLeg, overlay: legacy ? undefined : [4, 36, 4, 12], at: [4, 20] },
    legacy
      ? { base: rightLeg, mirrorOf: rightLeg, at: [8, 20] }
      : { base: [20, 52, 4, 12], overlay: [4, 52, 4, 12], at: [8, 20] },
  ];
}

/** Flat front view of a Minecraft skin, drawn pixel-exact on a canvas. */
export function SkinView({ src, slim, scale = 10, headOnly = false }: { src: string | null; slim: boolean; scale?: number; headOnly?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const width = headOnly ? 8 : 16;
  const height = headOnly ? 8 : 32;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!src) return;
    // No crossOrigin: the texture server sends no CORS headers, and drawing (not reading) pixels is fine.
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const legacy = img.height === 32;
      const draw = (r: Rect, x: number, y: number, mirror = false) => {
        ctx.save();
        if (mirror) {
          ctx.translate((x + r[2]) * scale, y * scale);
          ctx.scale(-1, 1);
          ctx.drawImage(img, r[0], r[1], r[2], r[3], 0, 0, r[2] * scale, r[3] * scale);
        } else {
          ctx.drawImage(img, r[0], r[1], r[2], r[3], x * scale, y * scale, r[2] * scale, r[3] * scale);
        }
        ctx.restore();
      };
      if (headOnly) {
        draw([8, 8, 8, 8], 0, 0);
        draw([40, 8, 8, 8], 0, 0);
        return;
      }
      for (const part of frontParts(slim, legacy)) {
        const [x, y] = part.at;
        draw(part.base, x, y, !!part.mirrorOf);
        if (part.overlay) draw(part.overlay, x, y);
      }
    };
    img.src = src;
  }, [src, slim, scale, headOnly]);

  return <canvas ref={ref} width={width * scale} height={height * scale} className="skin-canvas" />;
}
