import { completeNutrients, N, uuidv7, type CustomFood, type NutrientMap, type Portion } from '@ft/shared';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { NumberField } from '@/components/NumberField';
import { Page, Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { deleteRecord, restoreRecord, saveRecord } from '@/db/write';

const FIELDS = [
  { key: N.kcal, label: 'Kalorien', unit: 'kcal', required: true },
  { key: N.protein, label: 'Protein', unit: 'g' },
  { key: N.carbs, label: 'Kohlenhydrate', unit: 'g' },
  { key: N.sugar, label: 'davon Zucker', unit: 'g' },
  { key: N.fat, label: 'Fett', unit: 'g' },
  { key: N.satFat, label: 'davon gesättigte Fettsäuren', unit: 'g' },
  { key: N.fiber, label: 'Ballaststoffe', unit: 'g' },
  { key: N.salt, label: 'Salz', unit: 'g' },
] as const;

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
  const isNew = existing === null;
  const [name, setName] = useState(existing?.name ?? search.name ?? '');
  const [brand, setBrand] = useState(existing?.brand ?? '');
  const [barcode, setBarcode] = useState(existing?.barcode ?? search.barcode ?? '');
  const [unit, setUnit] = useState<'g' | 'ml'>(existing?.unit ?? 'g');
  const [mode, setMode] = useState<'per100' | 'perPortion'>('per100');
  const [servingGrams, setServingGrams] = useState<number | null>(null);
  const [values, setValues] = useState<Record<string, number | null>>(() =>
    existing ? Object.fromEntries(FIELDS.map((f) => [f.key, existing.nutrients[f.key] ?? null])) : {},
  );
  const [portions, setPortions] = useState<Portion[]>(existing?.portions ?? []);
  const [newPortion, setNewPortion] = useState<{ label: string; grams: number | null }>({
    label: '',
    grams: null,
  });
  const [touched, setTouched] = useState(false);

  const factor = mode === 'perPortion' ? (servingGrams && servingGrams > 0 ? 100 / servingGrams : null) : 1;
  const barcodeClean = barcode.replace(/\D/g, '');
  const errors = {
    name: !name.trim() ? 'Bitte einen Namen eingeben.' : null,
    kcal: values[N.kcal] === null || values[N.kcal] === undefined ? 'Kalorien sind Pflicht.' : null,
    serving: mode === 'perPortion' && !factor ? 'Portionsgröße angeben.' : null,
    barcode:
      barcodeClean && (barcodeClean.length < 6 || barcodeClean.length > 14) ? '6 bis 14 Ziffern.' : null,
  };
  const valid = !Object.values(errors).some(Boolean);

  async function save() {
    setTouched(true);
    if (!valid || !factor) return;
    const nutrients: NutrientMap = {};
    for (const f of FIELDS) {
      const v = values[f.key];
      if (v !== null && v !== undefined) nutrients[f.key] = Math.round(v * factor * 1000) / 1000;
    }
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
      nutrients: completeNutrients(nutrients),
      portions: allPortions,
    });
    toast.success(isNew ? 'Lebensmittel angelegt' : 'Gespeichert');
    if (search.date !== undefined) {
      await navigate({
        to: '/food/$foodId',
        params: { foodId: record.id },
        search: { date: search.date, meal: search.meal ?? 0, ...(search.into ? { into: search.into } : {}) },
        replace: true,
      });
    } else {
      await navigate({ to: '/custom-foods', replace: true });
    }
  }

  return (
    <Page
      title={isNew ? 'Eigenes Lebensmittel' : 'Lebensmittel bearbeiten'}
      back="/custom-foods"
      withTabBar={false}
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
              await navigate({ to: '/custom-foods', replace: true });
            }}
          >
            <Trash2 className="text-destructive" aria-hidden />
          </Button>
        ) : undefined
      }
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
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
              />
              {touched && errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
            </div>
            <div className="grid grid-cols-2 items-start gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="cf-brand">Marke (optional)</Label>
                <Input
                  id="cf-brand"
                  autoComplete="off"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cf-barcode">Barcode (optional)</Label>
                <Input
                  id="cf-barcode"
                  inputMode="numeric"
                  autoComplete="off"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  aria-invalid={errors.barcode ? true : undefined}
                />
                {errors.barcode && <p className="text-xs text-destructive">{errors.barcode}</p>}
              </div>
            </div>
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">Einheit</span>
              <ToggleGroup
                type="single"
                variant="outline"
                value={unit}
                onValueChange={(v) => v && setUnit(v as 'g' | 'ml')}
                className="w-full"
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

        <Section title="Nährwerte">
          <div className="grid gap-4 px-4 pb-4">
            <ToggleGroup
              type="single"
              variant="outline"
              value={mode}
              onValueChange={(v) => v && setMode(v as typeof mode)}
              className="w-full"
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
              />
            )}
            <div className="grid grid-cols-2 items-start gap-3">
              {FIELDS.map((f) => (
                <NumberField
                  key={f.key}
                  label={f.label}
                  unit={f.unit}
                  value={values[f.key] ?? null}
                  onValueChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
                  error={f.key === N.kcal && touched ? errors.kcal : null}
                  className={f.key === N.kcal ? 'col-span-2' : ''}
                />
              ))}
            </div>
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

        <Button type="submit" size="lg" className="w-full">
          {isNew ? (search.date !== undefined ? 'Anlegen und eintragen' : 'Anlegen') : 'Speichern'}
        </Button>
      </form>
    </Page>
  );
}
