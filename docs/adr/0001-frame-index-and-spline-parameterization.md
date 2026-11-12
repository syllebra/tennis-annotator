# ADR 0001 — Index de frame ordinal et temps comme paramètre des courbes

## Statut

Accepté.

## Contexte

L'outil doit annoter des vidéos de toute provenance : fps variable (VFR), téléphone portrait,
codecs divers, durées de quelques secondes à plusieurs dizaines de minutes. Les positions doivent
être rejouables frame par frame pour l'export et l'entraînement.

La spécification initiale demandait des « courbes de Bézier temporelles en 3D `(x, y, t)` ».
Une courbe de Bézier dont `t` est un axe peut revenir en arrière en temps : à une frame donnée
correspondent alors plusieurs positions possibles, ce qui rend l'échantillonnage temporel ambigu.
De plus, imposer que chaque impact soit un point de passage obligerait à dupliquer des poignées,
alors qu'un impact est par nature une rupture de direction.

## Décision

1. `t` est **l'index ordinal de la frame** dans l'ordre de présentation, jamais un timestamp et
   jamais une frame relative à une séquence.
2. Une courbe est `x(t)` et `y(t)` en segments cubiques (forme Hermite, mathématiquement
   identique à Bézier), avec passage exact par chaque point et tangentes automatiques
   (Catmull-Rom).
3. La tangente est **partagée** aux points de passage (courbe lisse) et **cassée** aux ancres
   (aller et retour indépendants).

## Conséquences

- Une seule position par frame, par construction : l'export est direct.
- Une vidéo VFR s'annote correctement : l'index ordinal est stable, la table `ffprobe` fournit le
  `pts` de chaque frame pour la lecture.
- Les poignées manuelles sur les points de passage sont écartées tant que l'usage ne les réclame
  pas : ajouter des points suffit à corriger une courbe.
- Le rendu et l'export doivent partager exactement la même arithmétique ; d'où les fixtures de
  conformité cross-langage.

## Alternatives écartées

- Bézier 3D `(x, y, t)` avec poignées libres : ambiguïté temporelle, édition pénible aux impacts.
- Timestamps en secondes : dépendants du fps, fragiles en VFR, non reproductibles.
- Courbe globale de degré N (un seul Bézier à N points) : instable au-delà de quelques points et
  impossible à casser localement aux impacts.
