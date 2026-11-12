# Écrire un script d'export vers un format d'entraînement

`annot bake` ne connaît **aucun** format d'entraînement. Il produit des données neutres,
lossless, et c'est ici que vous écrivez la conversion vers TrackNet, RT-DETR, YOLO ou autre.

## Ce que produit `bake`

Pour chaque vidéo annotée, dans le dossier de sortie :

### `<video>.npz` — tableaux NumPy

Chargé avec `numpy.load` :

| clé | dtype | sens |
|---|---|---|
| `frame` | int32 | index de frame absolu |
| `sequence` | int32 | index de la séquence dans le document |
| `trajectory` | int32 | index du trajet dans la séquence |
| `x`, `y` | float32 | position de la balle en **ratios** de la frame affichée |
| `court_x`, `court_y` | float32 | position projetée sur le plan du court, en **mètres** (`NaN` sans court) |
| `visible` | uint8 | 1 si la balle est dans le cadre (`0 ≤ x,y ≤ 1`) |
| `occluded` | uint8 | 1 si la frame appartient à une occultation |
| `frame_count`, `width`, `height` | int32 | métadonnées vidéo |

### `<video>.events.jsonl` — événements

Une ligne par **impact** (les ancres, hors `boundary`) :

```json
{"video":"m.mp4","sequence":"seq_01","trajectory":"traj_01","frame":40,
 "tag":"ground","x":0.62,"y":0.45,"courtX":4.66,"courtY":8.71,"side":"far"}
```

`courtX/courtY` sont nuls si aucun court n'est posé. `side` est déduit du signe de `courtY`.

## Règles à respecter dans la conversion

1. **Filtrer avant d'utiliser** : `visible == 1 and occluded == 0` pour l'apprentissage de la
   position visuelle. Les frames occultées ne doivent pas être étiquetées « balle présente ».
2. **Jamais d'upsampling temporel implicite** : `frame` n'est pas garanti contigu (un trajet peut
   sauter des frames) ; reconstruire une grille dense avec `np.interp` si le modèle l'exige, en
   marquant les frames interpolées.
3. **Découper par vidéo, pas par trajet** : les splits train/val doivent être disjoints en vidéo
   pour ne pas fuiter la même scène.
4. **La cible « court » est optionnelle** : `court_x/court_y` est déjà l'homographie appliquée.
   Si le modèle veut les landmarks image, utilisez le JSON d'annotation d'origine (source de
   vérité complète), pas le `.npz`.

## Exemple : heatmaps style TrackNet

```python
import numpy as np, json

data = np.load("baked/match_001.npz")
W, H = int(data["width"][0]), int(data["height"][0])
sigma, radius = 4.0, 24   # en pixels de la sortie du modèle

def heatmap(x, y, out_w, out_h):
    hm = np.zeros((out_h, out_w), dtype=np.float32)
    cx, cy = x * out_w, y * out_h
    ys, xs = np.mgrid[0:out_h, 0:out_w]
    hm[:] = np.exp(-(((xs - cx) ** 2 + (ys - cy) ** 2) / (2 * sigma**2)))
    return hm  # possibilité de seuiller à ~0.05 pour épargner le CPU

keep = (data["visible"] == 1) & (data["occluded"] == 0)
for x, y in zip(data["x"][keep], data["y"][keep]):
    target = heatmap(float(x), float(y), W // 4, H // 4)
```

Pour un TrackNet classique, on empile 3 frames consécutives et on prédit la heatmap de la
dernière ; l'absence de balle (`visible == 0`) doit produire une heatmap nulle, sinon le modèle
apprend à halluciner pendant les occultations.

## Exemple : RT-DETR / YOLO

Ces modèles attendent des boîtes ou des clés. La balle est un objet très petit : une boîte
de `max(3, round(0.006 * W))` pixels autour du centre est un bon point de départ, et le centre
seul (keypoint) est souvent plus efficace.

```python
import json

for line in open("baked/match_001.events.jsonl"):
    event = json.loads(line)
    # event["frame"], event["tag"], event["x"], event["y"] ...
    # tag ∈ hand | racket | ground | net | other
```

Les impacts sont des **événements ponctuels** : utiles pour un détecteur temporel séparé
(classification de frames d'impact) plutôt que pour un détecteur d'objets par frame.

## Vérifier avant d'entraîner

```bash
uv run python -m cli.main check <dossier>     # schéma + invariants + empreinte
uv run python -m cli.main bake  <dossier> --out <dossier>/baked
uv run python -m cli.main render <video>      # vidéo de contrôle à regarder
```
