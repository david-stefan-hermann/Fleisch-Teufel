import { ICON_FILES, useAppearance } from '@/lib/appearance';
import { cn } from '@/lib/utils';

/** The app logo in the variant of Mehr → Aussehen (follows the app theme by default). */
export function AppLogo({ size, className }: { size: number; className?: string }) {
  const { iconMode } = useAppearance();
  return (
    <img
      src={ICON_FILES[iconMode].logo}
      width={size}
      height={size}
      alt=""
      className={cn('shrink-0 drop-shadow-sm', className)}
    />
  );
}
