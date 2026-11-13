/** The figure the button wears on this device (Mehr → Aussehen). */
import { useAppearance } from '@/lib/appearance';
import { STANDARD_SKIN, type SkinView } from './SkinFace';

export function useSkin(): SkinView {
  const { assistantSkin } = useAppearance();
  void assistantSkin;
  return STANDARD_SKIN;
}
