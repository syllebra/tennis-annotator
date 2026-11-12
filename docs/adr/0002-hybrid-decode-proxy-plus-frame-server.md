# ADR 0002 — Décodage hybride : proxy pour la lecture, serveur de frames pour l'exactitude

## Statut

Accepté.

## Contexte

Deux besoins antagonistes :

- **fluidité** : jouer la vidéo à sa cadence, en avant et en arrière, sur des codecs variés
  (HEVC de téléphone, 4K, VFR) ;
- **exactitude** : afficher *exactement* la frame N quand on est à l'arrêt, y compris au pixel
  près pour la loupe.

Le `<video>` HTML5 n'est pas fiable pour l'exactitude (seek non garanti à la frame, codecs
manquants sous Linux, autorotation variable), et un décodage 100 % client via WebCodecs impose un
démultiplexage JS et un support codec aléatoire.

## Décision

1. **Lecture** : `<video>` sur le fichier original quand le navigateur sait le lire, sinon sur un
   **proxy H.264** généré en tâche de fond (NVENC, fallback libx264), avec `-fps_mode passthrough`
   pour conserver les timestamps VFR.
2. **Exactitude** : tout affichage à l'arrêt (pas-à-pas, loupe) vient d'un **décodeur serveur** qui
   lit **toujours le fichier original** avec `ffmpeg -ss <pts> -frames:v 1`, dans un cache LRU avec
   prefetch des frames voisines.
3. **Garde-fou** : le nombre de frames du proxy est comparé à celui de la source ; en cas
   d'écart, le proxy est rejeté et l'application passe en mode « frames seules ».

## Conséquences

- Aucune dérive possible entre ce qu'on voit et ce qu'on annote : un seul axe temporel, la source.
- Un aller-retour serveur (~10–30 ms) par frame à l'arrêt, masqué par le prefetch ; si cela devenait
  gênant, un client WebCodecs pourrait être ajouté sans changer le schéma ni le modèle.
- Le proxy peut être long à produire sur une vidéo de 30 minutes ; il est mis en cache par
  empreinte et n'est jamais bloquant pour l'annotation.
- Le serveur doit être local ; l'application est conçue mono-utilisateur, sans authentification.

## Alternatives écartées

- WebCodecs intégral : support codec aléatoire sous Linux, complexité de seek et de démux.
- Extraction préalable de toutes les frames : volume disque prohibitif sur des dizaines de vidéos.
- Se contenter du `<video>` : pas d'exactitude frame, incompatible avec l'annotation sub-pixel.
