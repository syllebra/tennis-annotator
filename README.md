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

### Lanceur global

```bash
./scripts/install-launcher.sh      # ou : make launcher
```

Installe `~/.local/bin/tennis-annotator` (lien vers ce dépôt) et une entrée **Tennis Annotator**
dans le menu d'applications.

```bash
tennis-annotator                     # dernier dossier utilisé
tennis-annotator ~/Videos/tennis     # définit la racine des vidéos
tennis-annotator ~/Videos/a.mp4      # ouvre directement cette vidéo
tennis-annotator --no-browser --port 9000
tennis-annotator --rebuild           # reconstruit le frontend avant de lancer
```

Au premier lancement, les dépendances Python sont installées (`uv sync`) et le frontend est
construit si `frontend/dist` manque. Une seule instance serveur à la fois : un second appel se
contente d'ouvrir l'interface existante, quel que soit le port demandé. Journaux :
`~/.local/state/tennis-annotator/server.log`. Désinstallation :
`./scripts/install-launcher.sh --uninstall`.

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

## Modèle : séquence, échange, segment

- Une **vidéo** contient plusieurs **séquences** (plages temporelles disjointes), par exemple une
  séquence par set, par caméra ou par session.
- Une **séquence** contient un **court** et plusieurs **échanges**.
- Un **échange** = **un point joué** (service, échange de fond, jusqu'au point marqué). C'est une
  seule spline d'un bout à l'autre, découpée en **segments** par les **impacts**
  (Main, Raquette, Sol, Filet, Autre, ou Bord en début/fin de vidéo). Entre deux impacts, on ajoute
  des **points de passage** pour faire épouser la courbe à la balle.

## Workflow d'annotation (tout est faisable à la souris)

1. **Charger la vidéo** depuis la bibliothèque.
2. **Créer une séquence** : boutons **IN** / **OUT** sous la vidéo, puis **Créer la séquence**.
   (raccourcis : `I`, `O`, `Ctrl+Entrée`)
3. **Poser le court** : bouton **Poser le court**, puis appuyer sur les 4 points dans l'ordre
   indiqué — le panneau affiche le nom de chaque point (« Coin double gauche (proche) », …) et un
   schéma numéroté. Chaque coin s'ajuste **avec le même geste que la balle** : appui → loupe en
   place ×10 → glisser → relâcher. Si la caméra bouge, se placer ailleurs et reposer.
4. **Créer un échange** : **+ nouvel échange** à la frame de la balle.
5. **Annoter** : **+ ancre** puis appuyer sur la balle — une **loupe en place ×10** apparaît sous le
   curseur, glisser pour ajuster au sub-pixel, relâcher pour valider. Même geste avec **+ point de
   passage** entre deux impacts. Les tags d'impact sont des boutons (Main, Raquette, Sol, Filet,
   Autre, Bord) ; **occultation** ouvre/ferme une plage masquée.
6. **Vérifier** : bouton **vérif.** relit l'échange en boucle avec la courbe échantillonnée.
7. **enregistrer** force la sauvegarde (autosave ~1 s de toute façon), `↶` / `↷` annulent.

Les raccourcis clavier existent pour aller plus vite (`Espace`, `←/→`, `A`, `P`, `1`–`5`, `U`, `V`,
`Ctrl+Z`…) mais ne sont jamais nécessaires : chaque action a son bouton.

**Zoom** : molette directement sur la timeline (centré sur le curseur), `Maj+molette` pour défiler
horizontalement, boutons `−` / `+`, **tout** et **séquence** pour recadrer. La loupe a ses propres
`−` / `+` et son curseur.

**Lisibilité de l'échange** : le segment en cours d'annotation reste net, les deux segments
précédents et suivants sont atténués, le reste de l'échange (courbe **et** points) est masqué. On
garde ainsi le contexte immédiat sans être tiré par la fin du point.

**Relecture de vérification** : le bouton **vérif.** (ou `V`) ouvre une **ball-cam** — un grossissement
centré sur la position annotée, qui suit la balle pendant la lecture. La croix marque ce que dit
l'annotation : si la balle s'en écarte, la courbe dérive. Boutons `◀` / `▶` pour avancer frame par
frame, lecture pour rejouer l'échange en boucle, `−` / `+` pour le grossissement. Un badge signale
une balle annotée hors cadre.

**Précision** : le geste est identique pour un point de balle et pour un coin du court. Pendant le
geste, la loupe en place est ancrée sur le point et la croix suit le déplacement amplifié ×10 ; on
peut aussi cliquer dans la loupe du panneau droit et utiliser la croix directionnelle (pas
0,1 / 1 / 5 px par clic). L'image est décodée en pleine résolution depuis le fichier original.

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
