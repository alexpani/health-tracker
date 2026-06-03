# Istruzioni per il repo `diario-alimentare`

Aggiungere l'endpoint `GET /api/external/plan-history` che espone lo **storico dei
piani alimentari** come segmenti datati, ricostruiti dai daily snapshot. Serve alla
dashboard health-tracker per mostrare i piani passati tra i "Terminati" (oltre
all'attivo "in corso") nella tab Regimi → Alimentazione.

## Contesto dati (già esistente nel diario)

- Tabella `daily_plan_snapshots(date, plan_name, kcal_target, protein_pct, fat_pct, carbs_pct, updated_at, user_id)`
  — una riga per giorno col piano in vigore quel giorno.
- Tabella `plans(... name, is_active ...)` — `is_active = 1` è il piano corrente.

## Modifica: `routes/external.js`

Aggiungere questo handler (stile coerente con `active-plan` esistente). Incollarlo
**prima** di `module.exports = router;`:

```js
// GET /api/external/plan-history
// Storico piani come segmenti datati, collassando i daily snapshot:
// run consecutivi con lo stesso plan_name = un segmento [start_date, end_date].
// I gap di date sono ammessi (un segmento si chiude solo al cambio di nome).
// L'ultimo segmento, se coincide col piano attivo, è "in corso" (end_date null).
router.get('/plan-history', async (req, res) => {
  try {
    const db = await getDb();
    const snaps = await db.all(`
      SELECT date, plan_name, kcal_target, protein_pct, fat_pct, carbs_pct, updated_at
      FROM daily_plan_snapshots
      WHERE user_id = 1
      ORDER BY date ASC
    `);

    const active = await db.get('SELECT name FROM plans WHERE is_active = 1 ORDER BY id LIMIT 1');
    const activeName = active ? active.name : null;

    const g = (kcal, pct, perG) => Math.round((kcal * pct / 100) / perG);
    const toSegment = (c) => ({
      name: c.plan_name,
      kcal_target: c.kcal_target,
      protein_pct: c.protein_pct,
      fat_pct: c.fat_pct,
      carbs_pct: c.carbs_pct,
      protein_g: g(c.kcal_target, c.protein_pct, 4),
      fat_g: g(c.kcal_target, c.fat_pct, 9),
      carbs_g: g(c.kcal_target, c.carbs_pct, 4),
      start_date: c.start_date,
      end_date: c.end_date,
      is_active: false,
    });

    const segments = [];
    let cur = null;
    for (const s of snaps) {
      if (cur && cur.plan_name === s.plan_name) {
        // Stesso piano: estendi il segmento, aggiorna i macro all'ultimo valore.
        cur.end_date = s.date;
        cur.kcal_target = s.kcal_target;
        cur.protein_pct = s.protein_pct;
        cur.fat_pct = s.fat_pct;
        cur.carbs_pct = s.carbs_pct;
      } else {
        if (cur) segments.push(toSegment(cur));
        cur = {
          plan_name: s.plan_name,
          kcal_target: s.kcal_target,
          protein_pct: s.protein_pct,
          fat_pct: s.fat_pct,
          carbs_pct: s.carbs_pct,
          start_date: s.date,
          end_date: s.date,
        };
      }
    }
    if (cur) segments.push(toSegment(cur));

    if (segments.length && activeName && segments[segments.length - 1].name === activeName) {
      segments[segments.length - 1].end_date = null;
      segments[segments.length - 1].is_active = true;
    }

    res.json(segments);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});
```

## Deploy

```bash
pm2 reload fooddiary    # o: pm2 restart fooddiary
```

## Verifica

```bash
curl -s http://localhost:3000/api/external/plan-history | python3 -m json.tool
```

Atteso (col tuo storico attuale): almeno due segmenti —
`"Keto Curcu"` (1200 kcal) con `end_date: "2026-05-27"` e
`"Keto Curcu +"` (1500 kcal) con `end_date: null`, `is_active: true`.

## Note

- Lo storico parte dalla prima riga in `daily_plan_snapshots` (≈ 2026-04-01). I piani
  precedenti non sono ricostruibili dal diario e restano coperti dai regimi diet
  manuali già presenti in health-tracker.
- Il proxy health-tracker (`GET /api/v1/diario/plan-history`) tratta un 404 come `[]`,
  quindi la dashboard funziona già anche prima di questo deploy (mostra solo l'attivo).
  Dopo il deploy, comparirà automaticamente lo storico completo.
