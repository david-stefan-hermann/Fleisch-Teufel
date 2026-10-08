import {
  DEFAULT_WEIGHT_KG,
  metFor,
  netExerciseKcal,
  round,
  today,
  type ExerciseTemplate,
  type Intensity,
} from '@ft/shared';
import { useBlocker, useNavigate, useParams, type ShouldBlockFn } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { DiscardDialog } from '@/components/DiscardDialog';
import { EmptyState, Page, Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { deleteRecord, patchRecord, restoreRecord } from '@/db/write';
import { useCurrentWeight } from '@/hooks/data';
import { useTypeOptions } from './training';
import { SportPicker, TrainingFields, TrainingKcal } from './TrainingFields';

/** Mehr → Gespeicherte Trainings → one: the fields of logging, without date and without logging. */
export function TrainingEditorPage() {
  const { templateId } = useParams({ from: '/authed/trainings/$templateId' });
  const db = useDb();
  const template = useLiveQuery(
    async () => (await db.exerciseTemplates.get(templateId)) ?? null,
    [db, templateId],
  );
  if (template === undefined) return null;
  if (!template || template.deleted) {
    return (
      <Page title="Training" back="/trainings" withTabBar={false}>
        <EmptyState title="Training nicht gefunden" />
      </Page>
    );
  }
  return <TrainingEditorForm key={template.id} template={template} />;
}

interface Fields {
  name: string;
  typeKey: string;
  intensity: Intensity;
  minutes: number | null;
  note: string;
}

const fieldsOf = (t: ExerciseTemplate): Fields => ({
  name: t.name,
  typeKey: t.typeKey,
  intensity: t.intensity,
  minutes: t.minutes,
  note: t.note ?? '',
});

function TrainingEditorForm({ template }: { template: ExerciseTemplate }) {
  const db = useDb();
  const navigate = useNavigate();
  const options = useTypeOptions();
  const weight = useCurrentWeight(today()) ?? DEFAULT_WEIGHT_KG;
  const [fields, setFields] = useState<Fields>(() => fieldsOf(template));
  const [filter, setFilter] = useState('');
  const set = (patch: Partial<Fields>) => setFields((f) => ({ ...f, ...patch }));

  const type = options.find((o) => o.key === fields.typeKey) ?? null;
  const met = type ? metFor(type, fields.intensity) : null;
  const kcal = met && fields.minutes ? round(netExerciseKcal(met, weight, fields.minutes), 0) : 0;
  const saved = fieldsOf(template);
  const name = fields.name.trim() || template.name;
  const dirty =
    name !== template.name ||
    fields.typeKey !== saved.typeKey ||
    fields.intensity !== saved.intensity ||
    fields.minutes !== saved.minutes ||
    fields.note.trim() !== saved.note.trim();
  const valid = !!type && !!fields.minutes && fields.minutes > 0;

  // The draft lives in this page only: any way out with changes asks first.
  const shouldBlockFn = useCallback<ShouldBlockFn>(() => dirty, [dirty]);
  const blocker = useBlocker({ shouldBlockFn, withResolver: true, enableBeforeUnload: false });

  async function save(): Promise<boolean> {
    if (!type || !fields.minutes) return false;
    await patchRecord(db, 'exerciseTemplates', template.id, {
      name: name.slice(0, 80),
      typeKey: type.key,
      typeName: type.name,
      minutes: fields.minutes,
      intensity: fields.intensity,
      note: fields.note.trim() || null,
    });
    setFields((f) => ({ ...f, name: f.name.trim() || template.name, note: f.note.trim() }));
    toast.success(`„${name}“ gespeichert`);
    return true;
  }

  async function remove() {
    await deleteRecord(db, 'exerciseTemplates', template.id);
    toast(`„${template.name}“ gelöscht`, {
      action: {
        label: 'Rückgängig',
        onClick: () => void restoreRecord(db, 'exerciseTemplates', template.id),
      },
    });
    await navigate({ to: '/trainings', ignoreBlocker: true });
  }

  return (
    <Page
      title={name}
      back="/trainings"
      withTabBar={false}
      actions={
        <Button variant="ghost" size="icon" aria-label="Training löschen" onClick={() => void remove()}>
          <Trash2 className="text-destructive" aria-hidden />
        </Button>
      }
      footer={
        <Button size="lg" disabled={!dirty || !valid} onClick={() => void save()}>
          Speichern
        </Button>
      }
    >
      <Section>
        <div className="grid gap-1.5 p-4">
          <Label htmlFor="training-name">Name</Label>
          <Input
            id="training-name"
            autoComplete="off"
            maxLength={80}
            value={fields.name}
            onChange={(e) => set({ name: e.target.value })}
          />
        </div>
      </Section>
      <Section title="Sportart">
        <SportPicker
          options={options}
          typeKey={fields.typeKey}
          onSelect={(typeKey) => set({ typeKey })}
          filter={filter}
          onFilterChange={setFilter}
          onCustomCreated={(typeKey) => set({ typeKey, intensity: 'moderate' })}
        />
      </Section>
      <Section>
        <div className="grid gap-4 p-4">
          <TrainingFields
            intensity={fields.intensity}
            onIntensityChange={(intensity) => set({ intensity })}
            intensityDisabled={type?.custom}
            minutes={fields.minutes}
            onMinutesChange={(minutes) => set({ minutes })}
            note={fields.note}
            onNoteChange={(note) => set({ note })}
          />
          <TrainingKcal
            label="Verbrauch beim aktuellen Gewicht"
            kcal={kcal}
            met={met}
            weightKg={weight}
            minutes={fields.minutes}
          />
          <p className="text-xs text-muted-foreground text-pretty">
            Änderungen gelten für künftige Einträge. Bereits eingetragene Trainings bleiben, wie sie sind.
          </p>
        </div>
      </Section>
      <DiscardDialog
        open={blocker.status === 'blocked'}
        name={template.name}
        onKeepEditing={() => blocker.reset?.()}
        onDiscard={() => blocker.proceed?.()}
        onSave={async () => {
          if (valid && (await save())) blocker.proceed?.();
          else blocker.reset?.();
        }}
      />
    </Page>
  );
}
