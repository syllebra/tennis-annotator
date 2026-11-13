# ADR 0004 — Les détecteurs ML tournent dans le dépôt voisin, dans un worker persistant

## Statut

Accepté.

## Contexte

Les détecteurs de balle et de court vivent dans `../live-tennis-analyzer`, un projet distinct :
Python 3.11, PyTorch 2.7 (CUDA), TensorRT 10.8 et des moteurs `.trt` construits pour cette carte.
Notre annotateur est un backend FastAPI léger en Python 3.12, qui doit rester installable sans
CUDA. Mesures sur la machine : import à froid de torch + TensorRT ≈ 33 s (disque), à chaud 0,9 s,
chargement des deux moteurs ≈ 1,5 s, inférence balle 0,13 s/frame en 1080p.

Un import direct est impossible (versions de Python incompatibles, dépendances GPU lourdes,
environnement du dépôt voisin potentiellement cassé — c'était le cas : venv créé sous WSL avec des
liens Windows).

## Décision

1. **Aucun import** des modules de perception dans notre backend. Un script `worker.py` vivant dans
   *notre* dépôt est exécuté par l'interpréteur du dépôt voisin.
2. Communication **JSON ligne à ligne** sur stdin/stdout, images transmises en base64 : ce sont
   exactement les frames décodées par notre frame server (rotation et indexation identiques), pas
   un deuxième décodage de la vidéo.
3. **Worker persistant** : démarrage paresseux au premier usage, bouton « Préparer », arrêt après
   15 min d'inactivité, redémarrage automatique après crash. Un aller-retour coûte alors quelques
   millisecondes au lieu de 3–4 s.
4. Le stdout du worker est réservé au protocole ; tout ce que les bibliothèques impriment part vers
   stderr (redirection de `fd 1`), donc les logs de TensorRT ne peuvent pas corrompre le canal.
5. Détection d'empreinte pour la disponibilité : dépôt, fichiers de code, moteurs, interpréteur.
   L'option est **masquée** quand elle n'est pas utilisable, jamais proposée en erreur.

## Conséquences

- Le backend de l'annotateur n'a ni torch ni TensorRT : il reste léger, testable sans GPU et
  installable sur une machine sans NVIDIA.
- Un plantage du détecteur ne peut pas tuer l'annotateur ; l'erreur remonte en 502 avec le
  diagnostic, et le document n'est jamais modifié à moitié.
- Une seule instance GPU, sérialisée par un verrou : pas de concurrence entre deux clics.
- Couplage faible mais réel avec le voisin : ordre des 14 keypoints du court et identifiant COCO 32
  pour la balle. Toute évolution de ces interfaces casse nos mappings — d'où les tests sur
  `court.py` et la validation par le score d'écart.
- Le premier appel après un démarrage à froid coûte ~35 s ; l'interface l'annonce et propose de
  précharger.
- Les modèles ne sont jamais régénérés par nous : leur construction reste de la responsabilité du
  dépôt voisin.

## Alternatives écartées

- Importer les modules : incompatible (3.11 vs 3.12) et imposerait torch au backend.
- Service HTTP ajouté au dépôt voisin : demande de modifier leur code et un port à gérer.
- Sous-processus jetable par action : 33 s à froid et 3–4 s à chaud pour chaque clic, dont la
  majeure partie n'est que du chargement.
- Réimplémenter les détecteurs : hors sujet.
