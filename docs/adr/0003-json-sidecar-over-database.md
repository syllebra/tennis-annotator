# ADR 0003 — Annotations en JSON à côté de la vidéo, pas de base de données

## Statut

Accepté.

## Contexte

Les annotations doivent être retrouvées automatiquement au chargement d'une vidéo, survivre aux
sauvegardes de l'utilisateur, et rester lisibles par les scripts d'export. Plusieurs dizaines de
vidéos, souvent déplacées ou copiées avec leur dossier.

## Décision

Un fichier `<nom_video>.<ext>.annotations.json` à côté de la vidéo, versionné
(`tennis-annotator/annotations@1`), en JSON indenté, clés ordonnées de façon déterministe, sans
horodatage. Écriture atomique (fichier temporaire + `fsync` + `rename`). Autosave débouncé côté
client, plus une empreinte partielle du fichier vidéo pour détecter une divergence.

## Conséquences

- Les annotations voyagent avec la vidéo : copier le dossier copie tout.
- Diffs git propres (objet par objet), relecture humaine possible, aucun schéma à migrer côté serveur.
- Pas de requête transverse (rechercher « tous les impacts `sol` ») : cela passe par le CLI, qui
  lit et agrège les fichiers.
- Un fichier peut être édité à la main et casser les invariants : le serveur valide à l'écriture et
  refuse tout document invalide.
- La divergence de vidéo est détectée par empreinte partielle (taille + 8 Mio de tête + 8 Mio de
  queue). Si le nombre de frames change, l'édition est refusée : on ne peut pas recaler des
  annotations temporelles automatiquement.

## Alternatives écartées

- SQLite : transactions et requêtes, mais illisible, non diffable, et le fichier doit être associé
  à la vidéo — ce qui annule l'intérêt du transport avec le dossier.
- Base serveur centrale : dépendance à une instance, perte de la portabilité des annotations.
- Format binaire (msgpack, parquet) : gain de taille négligeable à cette échelle, perte de lisibilité.
