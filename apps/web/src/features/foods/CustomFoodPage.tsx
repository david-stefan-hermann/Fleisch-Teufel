import { targetsForDate, today, uuidv7, type AiLabelResult, type CustomFood, type Portion } from '@ft/shared';
import { useNavigate, useParams, useRouter, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, ScanBarcode, ScanText, Sparkles, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { BarcodeScanSheet } from '@/components/BarcodeScanSheet';
import { LabelCaptureSheet } from '@/components/LabelCaptureSheet';
import { NumberField } from '@/components/NumberField';
import { NutrientEditor } from '@/components/NutrientEditor';
import { Page, Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { deleteRecord, restoreRecord, saveRecord } from '@/db/write';
import { useGoals } from '@/hooks/data';
import { useAiStatus } from '@/hooks/useAiStatus';
import { goBackOr } from '@/lib/history';
import { cn } from '@/lib/utils';
import {
  applyLabel,
  initFromFood,
  nutrientError,
  resetKcal,
  setField,
  toNutrients,
  type FormCode,
} from './customFoodForm';

/** How long a field filled from outside stays marked (matches `.field-flash`). */
const FLASH_MS = 1200;

export function CustomFoodPage() {
  const { id } = useParams({ from: '/authed/custom-food/$id' });
  const db = useDb();
  const isNew = id === 'new';
  const existing = useLiveQuery(
    async () => (isNew ? null : ((await db.customFoods.get(id)) ?? null)),
    [db, id, isNew],
  );
  if (existing === undefined) return null;
  return <CustomFoodForm key={existing?.id ?? 'new'} existing={existing} />;
}

function CustomFoodForm({ existing }: { existing: CustomFood | null }) {
  const search = useSearch({ from: '/authed/custom-food/$id' });
  const db = useDb();
  const navigate = useNavigate();
  const router = useRouter();
  const goals = useGoals();
  const isNew = existing === null;
  const toList = () => void navigate({ to: '/custom-foods', replace: true });
  const [name, setName] = useState(existing?.name ?? search.name ?? '');
  const [brand, setBrand] = useState(existing?.brand ?? '');
  const [barcode, setBarcode] = useState(existing?.barcode ?? search.barcode ?? '');
  const [unit, setUnit] = useState<'g' | 'ml'>(existing?.unit ?? 'g');
  const [mode, setMode] = useState<'per100' | 'perPortion'>('per100');
  const [servingGrams, setServingGrams] = useState<number | null>(null);
  const [nutrients, setNutrients] = useState(() => initFromFood(existing?.nutrients ?? null));
  const [portions, setPortions] = useState<Portion[]>(existing?.portions ?? []);
  const [newPortion, setNewPortion] = useState<{ label: string; grams: number | null }>({
    label: '',
    grams: null,
  });
  const [touched, setTouched] = useState(false);
  const [scanning, setScanning] = useState(false);
  const ai = useAiStatus();
  // From the scan page ("Etikett fotografieren") the label camera opens right away, once.
  const [labelOpen, setLabelOpen] = useState(() => search.label === '1');
  const [filledFromLabel, setFilledFromLabel] = useState(false);
  /** The model's note on the label (what was missing), shown until saving. */
  const [labelNote, setLabelNote] = useState<string | null>(null);
  useEffect(() => {
    if (search.label) void navigate({ to: '.', search: (s) => ({ ...s, label: undefined }), replace: true });
  }, [search.label, navigate]);
  /** Fields filled from outside (scan) that flash once. */
  const [flash, setFlash] = useState<ReadonlySet<string>>(() => new Set());
  const flashFields = (fields: string[]) => {
    setFlash(new Set(fields));
    window.setTimeout(() => setFlash(new Set()), FLASH_MS);
  };

  const factor = mode === 'perPortion' ? (servingGrams && servingGrams > 0 ? 100 / servingGrams : null) : 1;
  const barcodeClean = barcode.replace(/\D/g, '');
  // Another (not deleted) own food with this code: a hint only, saving stays allowed.
  const duplicate = useLiveQuery(
    async () =>
      barcodeClean
        ? ((await db.customFoods
            .where('barcode')
            .equals(barcodeClean)
            .filter((f) => !f.deleted && f.id !== existing?.id)
            .first()) ?? null)
        : null,
    [db, barcodeClean, existing?.id],
  );
  const errors = {
    name: !name.trim() ? 'Bitte einen Namen eingeben.' : null,
    nutrients: nutrientError(nutrients),
    serving: mode === 'perPortion' && !factor ? 'Portionsgröße angeben.' : null,
    barcode:
      barcodeClean && (barcodeClean.length < 6 || barcodeClean.length > 14) ? '6 bis 14 Ziffern.' : null,
  };
  const valid = !Object.values(errors).some(Boolean);

  function fillFromLabel(label: AiLabelResult, localBarcode: string | null) {
    const { next, changed } = applyLabel(
      { name, brand, barcode, unit, mode, servingGrams, portions, nutrients },
      label,
      localBarcode,
    );
    setName(next.name);
    setBrand(next.brand);
    setBarcode(next.barcode);
    setUnit(next.unit);
    setMode(next.mode);
    setServingGrams(next.servingGrams);
    setPortions(next.portions);
    setNutrients(next.nutrients);
    setLabelNote(label.notes);
    setLabelOpen(false);
    setFilledFromLabel(true);
    flashFields(changed);
    toast.success('Vom Etikett übernommen, bitte prüfen');
  }

  async function save() {
    setTouched(true);
    if (!valid || !factor) return;
    const allPortions = [...portions];
    if (mode === 'perPortion' && servingGrams && !allPortions.some((p) => p.grams === servingGrams)) {
      allPortions.unshift({ label: `Portion (${servingGrams} ${unit})`, grams: servingGrams });
    }
    const record = await saveRecord(db, 'customFoods', {
      id: existing?.id ?? uuidv7(),
      name: name.trim(),
      brand: brand.trim() || null,
      barcode: barcodeClean || null,
      unit,
      // All ten values; kJ and sodium are already derived where they were not typed.
      nutrients: toNutrients(nutrients, factor),
      portions: allPortions,
    });
    toast.success(isNew ? 'Lebensmittel angelegt' : 'Gespeichert');
    // "Anlegen und eintragen" opens the new food's page; everything else closes the editor.
    if (isNew && search.date !== undefined) {
      await navigate({
        to: '/food/$foodId',
        params: { foodId: record.id },
        search: { date: search.date, meal: search.meal ?? 0, ...(search.into ? { into: search.into } : {}) },
        replace: true,
      });
    } else {
      goBackOr(router.history, 1, toList);
    }
  }

  return (
    <Page
      title={isNew ? 'Eigenes Lebensmittel' : 'Lebensmittel bearbeiten'}
      back="/custom-foods"
      withTabBar={false}
      footer={
        <Button size="lg" type="submit" form="custom-food">
          {isNew ? (search.date !== undefined ? 'Anlegen und eintragen' : 'Anlegen') : 'Speichern'}
        </Button>
      }
      actions={
        existing ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Lebensmittel löschen"
            onClick={async () => {
              await deleteRecord(db, 'customFoods', existing.id);
              toast(`${existing.name} gelöscht`, {
                action: {
                  label: 'Rückgängig',
                  onClick: () => void restoreRecord(db, 'customFoods', existing.id),
                },
              });
              // From the food page back past it (it would show the deleted food), else to the list.
              goBackOr(router.history, search.from === 'food' ? 2 : 1, toList);
            }}
          >
            <Trash2 className="text-destructive" aria-hidden />
          </Button>
        ) : undefined
      }
    >
      <form
        id="custom-food"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {ai !== 'loading' && ai !== 'off' && (
          <LabelEntry
            compact={!isNew || filledFromLabel}
            offline={ai === 'offline'}
            onOpen={() => setLabelOpen(true)}
          />
        )}
        <Section>
          <div className="grid gap-4 p-4">
            <div className="grid gap-1.5">
              <Label htmlFor="cf-name">Name</Label>
              <Input
                id="cf-name"
                name="name"
                autoComplete="off"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="z. B. Omas Apfelkuchen…"
                aria-invalid={touched && errors.name ? true : undefined}
                className={cn(flash.has('name') && 'field-flash')}
              />
              {touched && errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cf-brand">Marke (optional)</Label>
              <Input
                id="cf-brand"
                autoComplete="off"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                className={cn(flash.has('brand') && 'field-flash')}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cf-barcode">Barcode (optional)</Label>
              {/* 13 digits and the scan button do not fit half a row, so the field has its own. */}
              <div className="relative">
                <Input
                  id="cf-barcode"
                  inputMode="numeric"
                  autoComplete="off"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  aria-invalid={errors.barcode ? true : undefined}
                  aria-describedby="cf-barcode-hint"
                  className={cn('pr-12', flash.has('barcode') && 'field-flash')}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Barcode scannen"
                  className="absolute top-0.5 right-0.5 text-muted-foreground"
                  onClick={() => setScanning(true)}
                >
                  <ScanBarcode className="size-5" aria-hidden />
                </Button>
              </div>
              <p id="cf-barcode-hint" aria-live="polite" className="empty:hidden">
                {errors.barcode ? (
                  <span className="text-xs text-destructive">{errors.barcode}</span>
                ) : duplicate ? (
                  <span className="text-xs text-muted-foreground">
                    Schon bei „{duplicate.name}“ hinterlegt.
                  </span>
                ) : null}
              </p>
            </div>
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">Einheit</span>
              <ToggleGroup
                type="single"
                variant="outline"
                value={unit}
                onValueChange={(v) => v && setUnit(v as 'g' | 'ml')}
                className={cn('w-full rounded-lg', flash.has('unit') && 'field-flash')}
              >
                <ToggleGroupItem value="g" className="flex-1">
                  Gramm (fest)
                </ToggleGroupItem>
                <ToggleGroupItem value="ml" className="flex-1">
                  Milliliter (flüssig)
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>
        </Section>

        {labelNote && (
          <p className="mb-4 flex gap-2 rounded-xl bg-muted p-3 text-sm text-pretty">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span>{labelNote}</span>
          </p>
        )}
        <Section title="Nährwerte">
          <div className="grid gap-4 px-4 pb-4">
            <ToggleGroup
              type="single"
              variant="outline"
              value={mode}
              onValueChange={(v) => v && setMode(v as typeof mode)}
              className={cn('w-full rounded-lg', flash.has('mode') && 'field-flash')}
              aria-label="Bezug der Nährwerte"
            >
              <ToggleGroupItem value="per100" className="flex-1">
                pro 100 {unit}
              </ToggleGroupItem>
              <ToggleGroupItem value="perPortion" className="flex-1">
                pro Portion
              </ToggleGroupItem>
            </ToggleGroup>
            {mode === 'perPortion' && (
              <NumberField
                label="Portionsgröße"
                unit={unit}
                value={servingGrams}
                onValueChange={setServingGrams}
                error={touched ? errors.serving : null}
                hint={`Wird beim Speichern auf 100 ${unit} umgerechnet.`}
                inputClassName={cn(flash.has('servingGrams') && 'field-flash')}
              />
            )}
            <NutrientEditor
              idPrefix="cf"
              state={nutrients}
              onChange={(code, v) => setNutrients((s) => setField(s, code, v))}
              onResetKcal={() => setNutrients(resetKcal)}
              targets={targetsForDate(goals ?? [], today())}
              error={touched ? errors.nutrients : null}
              defaultMicrosOpen={!isNew}
              highlighted={flash as ReadonlySet<FormCode>}
            />
          </div>
        </Section>

        <Section title="Portionen">
          <div className="grid gap-3 px-4 pb-4">
            {portions.length === 0 && (
              <p className="text-sm text-muted-foreground">Optional, z. B. „1 Stück“ = 120 g.</p>
            )}
            <ul className="grid gap-2">
              {portions.map((p, i) => (
                <li
                  key={`${p.label}-${i}`}
                  className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm"
                >
                  <span>
                    {p.label} · {p.grams} {unit}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${p.label} entfernen`}
                    onClick={() => setPortions(portions.filter((_, j) => j !== i))}
                  >
                    <X aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
            <div className="flex items-end gap-2">
              <div className="grid flex-1 gap-1.5">
                <Label htmlFor="cf-portion">Bezeichnung</Label>
                <Input
                  id="cf-portion"
                  autoComplete="off"
                  placeholder="1 Stück…"
                  value={newPortion.label}
                  onChange={(e) => setNewPortion({ ...newPortion, label: e.target.value })}
                />
              </div>
              <NumberField
                className="w-28"
                label={unit}
                value={newPortion.grams}
                onValueChange={(g) => setNewPortion({ ...newPortion, grams: g })}
              />
              <Button
                type="button"
                variant="outline"
                size="icon-lg"
                aria-label="Portion hinzufügen"
                disabled={!newPortion.label.trim() || !newPortion.grams}
                onClick={() => {
                  setPortions([...portions, { label: newPortion.label.trim(), grams: newPortion.grams! }]);
                  setNewPortion({ label: '', grams: null });
                }}
              >
                <Plus aria-hidden />
              </Button>
            </div>
          </div>
        </Section>
      </form>
      {labelOpen && <LabelCaptureSheet onResult={fillFromLabel} onClose={() => setLabelOpen(false)} />}
      {scanning && (
        <BarcodeScanSheet
          onClose={() => setScanning(false)}
          onDetected={(code) => {
            setScanning(false);
            setBarcode(code);
            flashFields(['barcode']);
            toast.success('Barcode übernommen');
          }}
        />
      )}
    </Page>
  );
}

/**
 * Entry to "Etikett fotografieren": a tile on a new food, a small button when editing (or after a
 * first fill). Offline it is disabled ("Nur online"); without AI on the server the page hides it.
 */
function LabelEntry({
  compact,
  offline,
  onOpen,
}: {
  compact: boolean;
  offline: boolean;
  onOpen: () => void;
}) {
  if (compact)
    return (
      <Button type="button" variant="outline" className="mb-4 w-full" disabled={offline} onClick={onOpen}>
        <ScanText className="text-primary" aria-hidden />
        {offline ? 'Vom Etikett neu ausfüllen (nur online)' : 'Vom Etikett neu ausfüllen'}
      </Button>
    );
  return (
    <button
      type="button"
      disabled={offline}
      onClick={onOpen}
      className="mb-4 flex min-h-16 w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-left shadow-xs hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
    >
      <ScanText className="size-7 shrink-0 text-primary" aria-hidden />
      <span>
        <span className="block font-semibold">Etikett fotografieren</span>
        <span className="block text-[0.8125rem] text-muted-foreground">
          {offline ? 'Nur online' : 'Name, Barcode und Nährwerte per KI ausfüllen'}
        </span>
      </span>
    </button>
  );
}
