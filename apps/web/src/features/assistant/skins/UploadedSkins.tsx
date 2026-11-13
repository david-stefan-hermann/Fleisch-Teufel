/** The uploaded figures on the appearance page: choose, delete, add ("Eigene Figur"). */
import type { SkinInfo } from '@ft/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import type { AssistantSkin } from '@/db/dexie';
import { errorMessage } from '@/lib/api';
import { setAssistantSkin, useAppearance } from '@/lib/appearance';
import { SkinPackError } from './pack';
import { STANDARD_SKIN } from './SkinFace';
import { AddSkinTile, SkinTile } from './SkinPicker';
import { deleteSkin, downloadSkin, dropRemovedSkins, listServerSkins, uploadSkin } from './uploads';
import { skinView, useSkinUrls } from './useSkin';

const message = (e: unknown) => (e instanceof SkinPackError ? e.message : errorMessage(e));

export function UploadedSkins() {
  const db = useDb();
  const { assistantSkin } = useAppearance();
  const local = useLiveQuery(() => db.assistantSkins.orderBy('id').toArray(), [db]);
  const [server, setServer] = useState<SkinInfo[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    let live = true;
    listServerSkins().then(
      async (list) => {
        await dropRemovedSkins(db, list);
        if (live) setServer(list);
      },
      () => {
        // Offline: the copies on this device.
      },
    );
    return () => {
      live = false;
    };
  }, [db]);

  const mine = new Map((local ?? []).map((s) => [s.id, s]));
  const remoteOnly = (server ?? []).filter((s) => !mine.has(s.id));

  const choose = async (info: SkinInfo) => {
    setBusy(info.id);
    try {
      await downloadSkin(db, info);
      setAssistantSkin(info.id);
    } catch (e) {
      toast.error(message(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {(local ?? []).map((s) => (
        <LocalTile
          key={s.id}
          skin={s}
          selected={assistantSkin === s.id}
          onRemove={() => setRemoving({ id: s.id, name: s.name })}
        />
      ))}
      {remoteOnly.map((s) => (
        <SkinTile
          key={s.id}
          skin={{ ...STANDARD_SKIN, name: s.name }}
          selected={false}
          onSelect={() => void choose(s)}
        >
          {busy === s.id && <span className="absolute inset-0 animate-pulse rounded-xl bg-background/60" />}
        </SkinTile>
      ))}
      <AddSkinTile
        busy={busy !== null}
        onPick={(file) => {
          setBusy('upload');
          void uploadSkin(db, file)
            .then((s) => {
              setAssistantSkin(s.id);
              toast.success(`„${s.name}“ hinzugefügt`);
            })
            .catch((e) => toast.error(message(e)))
            .finally(() => setBusy(null));
        }}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`„${removing?.name ?? ''}“ löschen?`}
        description="Die Figur verschwindet von allen Geräten."
        confirmLabel="Löschen"
        destructive
        onConfirm={async () => {
          if (!removing) return;
          try {
            await deleteSkin(db, removing.id);
            if (assistantSkin === removing.id) setAssistantSkin('standard');
          } catch (e) {
            toast.error(message(e));
          }
        }}
      />
    </>
  );
}

function LocalTile({
  skin,
  selected,
  onRemove,
}: {
  skin: AssistantSkin;
  selected: boolean;
  onRemove: () => void;
}) {
  const urls = useSkinUrls(skin);
  const view = urls
    ? skinView(skin.id, skin.manifest, urls, { width: skin.width, grid: 1 })
    : { ...STANDARD_SKIN, name: skin.name };
  return (
    <SkinTile skin={view} selected={selected} onSelect={() => setAssistantSkin(skin.id)}>
      <button
        type="button"
        aria-label={`${skin.name} löschen`}
        onClick={onRemove}
        className="absolute -top-2 -right-2 grid size-7 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow-sm"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </SkinTile>
  );
}
