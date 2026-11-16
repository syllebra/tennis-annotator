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
tennis-annotator --host 0.0.0.0 --port 8123   # accessible sur le réseau local
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
   place ×10 → glisser → relâcher. Si la caméra bouge, se placer ailleurs et reposer : chaque pose
   apparaît comme un losange dans la timeline (ligne **court**), et les poses se naviguent avec
   `◀ pose` / `pose ▶`. À une pose, les 4 points sont listés dans le panneau : en cliquer un le
   sélectionne pour l'ajuster individuellement (glisser sur la vidéo ou croix directionnelle).
   Entre deux poses, le court se déplace en **interpolation linéaire** (aucun dépassement).
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

## Accès protégé par token

Au premier démarrage, le backend génère un token aléatoire, l'écrit dans
`~/.config/tennis-annotator/auth.json` (droits `0600`) et l'affiche dans la console. L'interface HTML
**et** toutes les routes `/api/*` exigent une session : sans cookie valide, le serveur renvoie une
page de login, et l'API répond `401`.

- Le **lanceur global** lit le token et ouvre `http://127.0.0.1:8001/?token=…`, qui pose le cookie
  puis redirige : rien à saisir.
- À la main : ouvrir l'URL, coller le token dans la page.
- `TENNIS_ANNOTATOR_TOKEN=…` force un token (script, test, conteneur) et n'écrit aucun fichier.
- Session : cookie `HttpOnly` signé en HMAC-SHA256, valable 30 jours ; changer le token invalide
  toutes les sessions. Le bouton **verrouiller** (bibliothèque) ferme la session.
- Réinitialiser : supprimer `auth.json` et redémarrer.
- `--host 0.0.0.0` expose l'interface au réseau local ; le lanceur affiche alors l'adresse réseau et
  un avertissement. Le token protège l'accès, mais **le trafic n'est pas chiffré** : ne partage
  pas une URL contenant `?token=…` sur un réseau non sûr (le token passerait en clair).
- Limite assumée : c'est un secret partagé pour un outil local mono-utilisateur, pas un système de
  comptes. Quiconque peut lire le fichier peut entrer — le token protège contre un accès accidentel
  au port (autre processus, tunnel, bind mal configuré), pas contre quelqu'un qui a déjà la main
  sur la machine.

## Détecteurs optionnels (balle et court)

Si le dépôt `../live-tennis-analyzer` est présent (ou le chemin renseigné dans
**Bibliothèque → Détecteurs**), deux raccourcis apparaissent :

- **Détecter le court** (panneau Séquence, et dans l'assistant) : appelle le détecteur de keypoints
  sur la frame courante et crée une pose avec **uniquement les 4 coins extérieurs du double**. Les
  10 autres keypoints du modèle servent à calculer l'écart moyen affiché, puis sont jetés. Le preset
  passe à « coins double » ; les poses existantes sont conservées et complétées par les 4 coins
  double, projetés depuis leur propre homographie (géométrie inchangée, vérifié à 0,0000 px).
- **try auto** (panneau Échanges, actif quand le playhead est entre deux impacts) : détecte la balle
  frame par frame sur le segment, écarte les faux positifs par RANSAC, puis n'ajoute que les points
  de passage nécessaires pour rester sous la tolérance (2 px, 8 points max par défaut). Le bandeau
  indique points ajoutés, erreur max, frames retenues/rejetées, et signale les détections éparses ou
  une trajectoire quasi immobile. Les points créés portent `source: auto` (halo pointillé) et tout
  est annulable d'un `Ctrl+Z`.

Chaque point affiché — y compris ceux créés par les détecteurs (`source: auto`, halo pointillé) —
se manipule avec le même geste : appui → loupe en place ×10 → glisser → relâcher. Hors d'une pose
court, les 4 coins de la pose **la plus proche** restent visibles en pointillé grisé : en cliquer un
saute à cette pose et ouvre la loupe dans le même geste.

Les modèles tournent dans le dépôt voisin, jamais importés ici : un **worker persistant** est lancé
au premier usage (~35 s à froid, quelques ms ensuite), arrêté après 15 min d'inactivité.
**Préparer** précharge les modèles. Découverte : `TENNIS_ANALYZER_DIR`, puis le champ de
configuration, puis `../live-tennis-analyzer`, puis un balayage des dossiers voisins. Si
l'environnement Python du voisin est cassé (venv créé sous WSL par exemple), le diagnostic l'indique
et l'outil utilise l'interpréteur `uv` du dépôt à la place.

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

## Licence

MIT — voir [LICENSE](LICENSE).
