import {
  Book, Briefcase, Camera, Coffee, Film, Gift, Globe, Heart, LayoutGrid, Lightbulb,
  Map, Music, Palette, PenTool, Rocket, Star, type LucideIcon,
} from 'lucide-react';
import { isDark } from '../doc';

const ICONS: Record<string, LucideIcon> = {
  layout: LayoutGrid, lightbulb: Lightbulb, palette: Palette, camera: Camera, rocket: Rocket,
  book: Book, music: Music, film: Film, heart: Heart, star: Star, globe: Globe,
  briefcase: Briefcase, pen: PenTool, coffee: Coffee, map: Map, gift: Gift,
};

export function BoardIcon({ icon, color, size = 72 }: { icon: string; color: string; size?: number }) {
  const Icon = ICONS[icon] ?? LayoutGrid;
  return (
    <div className="board-icon" style={{ width: size, height: size, background: color, borderRadius: size * 0.22 }}>
      <Icon size={size * 0.42} strokeWidth={1.8} color={isDark(color) ? '#fff' : '#323b4a'} />
    </div>
  );
}
