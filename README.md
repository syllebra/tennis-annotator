# Tennis Annotator

Outil local d'annotation de vidéos de tennis pour entraîner des modèles de détection temps réel :
repérage du court (4 landmarks minimum) et trajets de balle, sur vidéo frame-exacte.

Backend Python/FastAPI, frontend React/TypeScript, sauvegarde JSON à côté de la vidéo.

## Démarrage

```bash
# dépendances Python (épinglé 3.12 via .python-version)
uv sync

# frontend
cd frontend && npm install && npm run build && cd ..

# lancer l'application (http://127.0.0.1:8001)
uv run python -m cli.main serve
```

Au premier lancement : « Parcourir… » pour choisir le dossier racine des vidéos, puis cliquer une
vidéo. Les annotations sont lues/écrites dans `<video>.annotations.json` (à côté de la vidéo).

### Développement

```bash
# terminal 1 : backend
uv run python -m cli.main serve --reload
# terminal 2 : frontend avec proxy /api -> 8001
cd frontend && npm run dev
```

## Tests

```bash
uv run pytest                           # géométrie, frame server, schéma, persistance, API
uv run python scripts/gen_fixtures.py   # fixtures de conformité cross-langage
cd frontend && npm test                 # parité Python/TS + helpers de dérivation
```

Test de bout en bout (optionnel, utilise le Chromium du système) :

```bash
uv run python -m cli.main serve --port 8011     # dans un terminal
cd frontend && node tests/e2e.smoke.mjs http://127.0.0.1:8011
```

`CHROMIUM_PATH=/usr/bin/brave node tests/e2e.smoke.mjs …` pour un autre navigateur. Le test crée
une séquence, place le court, annote un trajet, recharge la page et vérifie la persistance — et
échoue si la moindre erreur console apparaît.

## Workflow d'annotation

1. **Charger la vidéo** depuis la bibliothèque.
2. **Créer une séquence** : `I` (début), `O` (fin), `Ctrl+Entrée`.
3. **Poser le court** : `C` puis cliquer les 4 points dans l'ordre demandé (coins du double par
   défaut ; presets coins du simple / carrés de service dans le panneau). Si la caméra bouge,
   se placer à une autre frame et `C` de nouveau.
4. **Créer un trajet balle** : `B` à la frame de la balle.
5. **Annoter** : `A` ajoute une ancre à la position du curseur, `P` ajoute un point de passage
   entre deux ancres, `1`–`5` posent le tag d'impact, `0` un bord, `U` ouvre/ferme une occultation.
6. **Vérifier** : `V` relit le trajet en boucle avec la courbe échantillonnée.
7. `Ctrl+Z` annule, `Ctrl+S` force la sauvegarde (autosave ~1 s de toute façon).

La loupe permet un placement sub-pixel : cliquer dedans pour lui donner le focus, puis les flèches
déplacent le point sélectionné de 0,1 px (`Shift` = 1 px, `Alt` = 5 px). L'image y est décodée en
pleine résolution depuis le fichier original.

## Ligne de commande

```bash
uv run python -m cli.main check  <dossier>   # valide schémas, invariants et empreintes vidéo
uv run python -m cli.main bake   <dossier>   # échantillonne par frame (npz + events.jsonl)
uv run python -m cli.main render <video>     # vidéo de contrôle avec overlay
```

`bake` produit un format **neutre** (aucune connaissance d'un format d'entraînement).
Voir `docs/export-scripts.md` pour écrire les conversions TrackNet / RT-DETR.

## Architecture

- **Décodage** : lecture fluide via `<video>` (original ou proxy H.264 généré en tâche de fond),
  mais toute frame *à l'arrêt* vient d'un **décodeur serveur** qui lit toujours le fichier original
  (`ffmpeg -ss <pts> -frames:v 1`), avec cache LRU et prefetch. Aucune dérive proxy/source possible.
- **Temps** : `t` est un **index de frame ordinal** (vidéo VFR et sans fps contraint supportées).
- **Courbes** : `x(t)`, `y(t)` en segments cubiques (Hermite/Bézier), tangentes auto type
  Catmull-Rom, tangente cassable aux ancres (impacts), passage exact par chaque point.
- **Court** : homographie DLT normalisée recalculée à chaque frame depuis les landmarks interpolés.
- **Parité math** : `backend/app/geometry.py` et `frontend/src/math.ts` sont deux répliques
  verrouillées par `tests/fixtures/conformance.json` (Python génère, vitest vérifie).

Détails : `docs/adr/`. Glossaire : `CONTEXT.md`. Schéma : `docs/annotations.schema.json`.
