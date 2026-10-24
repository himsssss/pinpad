import { ImagePlus } from 'lucide-react';
import type { ImageEl } from '../../types';
import { mutate } from '../../store';
import { pickImages } from '../../images';
import { Editable } from '../Editable';

export function ImageCard({ el, editing }: { el: ImageEl; editing: boolean }) {
  if (!el.src) {
    return (
      <button
        className="card-body image-empty"
        data-nodrag
        onClick={async () => {
          const [src] = await pickImages(false);
          if (src) mutate((d) => { (d.elements[el.id] as ImageEl).src = src; });
        }}
      >
        <ImagePlus size={28} strokeWidth={1.5} />
        <span>Click to upload an image</span>
      </button>
    );
  }
  return (
    <div className="card-body image">
      <img src={el.src} alt={el.caption} draggable={false} />
      {(el.caption || editing) && (
        <Editable
          className="image-caption"
          value={el.caption}
          editing={editing}
          placeholder="Add a caption"
          onChange={(caption) => mutate((d) => { (d.elements[el.id] as ImageEl).caption = caption; }, 'pending')}
        />
      )}
    </div>
  );
}
