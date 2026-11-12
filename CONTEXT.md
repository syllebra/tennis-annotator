# Tennis Annotator — glossaire

Vocabulaire du domaine. Aucun détail d'implémentation ici.

| Terme | Définition |
|---|---|
| **Vidéo** | un fichier vidéo d'une session de tennis, identifié par un index de frames et une empreinte de contenu. |
| **Séquence** | une plage temporelle continue d'une vidéo, non chevauchante, dans laquelle on annote un court et des trajets de balle. |
| **Frame** | une image de la vidéo, désignée par son **index ordinal** dans l'ordre de présentation (0 = première image). |
| **Court** | le terrain de tennis, dont la position dans l'image est décrite par des landmarks. |
| **Landmark** | un point du court identifié dans un catalogue (coin, intersection de lignes, poteau…), dont la position physique est connue en mètres. |
| **Repère court** | repère physique en mètres : origine au centre du filet au sol, axe Y vers la ligne de fond lointaine, axe Z vertical. |
| **Keyframe court** | un placement groupé de landmarks à une frame donnée. Une seule keyframe décrit un court statique ; plusieurs décrivent une caméra mobile. |
| **Précision du repérage** | part du court couverte par le quadrilatère réellement annoté ; sous un seuil, les lignes déduites sont des extrapolations peu fiables. |
| **Échange** (syn. *trajet*) | **un point joué** : l'ensemble du parcours de la balle pour un point du match (service, échanges de fond, jusqu'au point marqué). Décrit par une seule courbe, découpée en **segments** par les impacts. |
| **Segment** | la portion de courbe entre deux impacts consécutifs d'un échange. Un échange compte donc *n impacts − 1* segments. |
| **Ancre** | un point d'un trajet qui **est** un événement : un impact (`Main`, `Raquette`, `Sol`, `Filet`, `Autre`) ou un bord de trajet (`Bord`). La courbe peut y changer brutalement de direction. |
| **Point de passage** | un point intermédiaire posé sur la balle, entre deux ancres, pour faire épouser la courbure du trajet. La courbe y passe sans rupture. |
| **Bord** | ancre sentinelle signifiant « le trajet commence ou se termine ici, en plein vol ». Uniquement en première ou dernière position. |
| **Occultation** | une plage de frames où la balle est masquée alors que sa position reste connue. |
| **Vérification** | relecture en boucle d'un trajet avec la courbe échantillonnée superposée à la vidéo. |
| **Statut d'annotation** | `non commencée`, `en cours`, `terminée` — « terminée » est un choix explicite de l'annotateur. |

Termes à éviter :

- « point de contrôle » : ambigu, il désigne tantôt une ancre, tantôt une poignée de courbe. Dire **ancre** ou **point de passage**.
- « timestamp » : le temps d'annotation est un index de frame, pas une seconde.
- « trajet du court » : le court ne se déplace pas, on décrit ses **keyframes**.
- « trajet » employé pour un simple vol de balle : par convention, un trajet = un échange complet
  (plusieurs segments), pas un segment.
