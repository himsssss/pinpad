import type { DrawingEl } from '../../types';
import { strokePath } from '../../drawing';

export function DrawingCard({ el }: { el: DrawingEl }) {
  return (
    <svg className="card-body drawing" viewBox={`0 0 ${el.vw} ${el.vh}`} width="100%" style={{ aspectRatio: `${el.vw} / ${el.vh}` }}>
      {el.strokes.map((s, i) => (
        <path key={i} d={strokePath(s.points)} stroke={s.color} strokeWidth={s.size} />
      ))}
    </svg>
  );
}
