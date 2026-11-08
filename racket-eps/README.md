# Racket EPS — suivi de cycle et classement Elo

Application web pour suivre une classe pendant un cycle de sport de raquette : appel, placement sur les terrains, tournoi de la séance (5 formats), saisie des scores, classement **Elo** du cycle et fiches élèves. HTML/CSS/JS sans framework ni build ; fonctionne en ouvrant `index.html` (y compris en `file://`) ou sur un hébergement statique (Vercel).

Le cahier des charges est dans [`CLAUDE.md`](CLAUDE.md).

## Fichiers
```
index.html   page
engine.js    moteur pur et testé (Elo, formats, terrains, persistance) — window.RacketEngine
app.js       interface
style.css    styles (repris du prototype V1)
qr.js        générateur de QR codes (sans dépendance) — window.RacketQR
tests/       tests du moteur et du générateur QR (node --test), parcours navigateur (Playwright)
```

## Règles métier implémentées
- **Elo figé pendant la séance.** Chaque match validé contribue `K × (S − E)` avec les Elo de **début** de séance. Les variations sont sommées puis appliquées toutes en même temps à la clôture, donc l'ordre de saisie ne change rien. La précision est conservée en mémoire ; l'arrondi ne se fait qu'à l'affichage.
- **Recalcul chronologique.** Le classement est recalculé à partir des séances clôturées, dans l'ordre. Corriger une séance passée (Historique → Rouvrir) recalcule les séances suivantes sans double comptage. *Annuler la correction* restaure la séance d'origine.
- **Ce qui ne compte pas pour l'Elo :** match non validé, forfait, exemption, séance non clôturée. Les absents ne jouent pas et gardent leur Elo.
- **Politique des forfaits :** un forfait donne la victoire au tournoi de la séance, mais **ni Elo, ni points marqués ou encaissés**. Il est comptabilisé à part (victoires et défaites par forfait).
- **Deux classements distincts :** le classement de la séance (points de tournoi) et le classement Elo du cycle.
- **Placement :** il est proposé dans l'ordre Elo, sans les absents. L'enseignant ajuste (groupes ou ordre), puis **valide**. Le placement validé est exactement celui qui sert à générer les matchs.
- **Terrains modifiables en cours de séance** (onglet Séance, « Terrains disponibles − / + », et bouton « Fermer » sur chaque terrain) :
  - on peut ajouter ou retirer un terrain, ou en fermer un précis (pas forcément le dernier), puis le rouvrir ;
  - un match en cours sur un terrain retiré retourne en file d'attente, après confirmation ;
  - les matchs sont réaffectés aussitôt, et il reste toujours au moins un terrain ouvert ;
  - ce réglage ne vaut que pour la séance : le nombre de terrains de la classe (Réglages) reste la valeur par défaut des prochaines séances.
- **Terrains :** un terrain accueille un seul match à la fois, et un élève ne joue jamais deux matchs simultanés. Les matchs attendent un terrain libre (file d'attente), et le terrain du groupe est privilégié quand il est libre.

## Formats
| Format | Fonctionnement |
|---|---|
| Poules classiques | Groupes équilibrés de 3 à 6 (écart ≤ 1), aller simple ou aller-retour, tours organisés par la méthode du cercle. Classement par poule : victoires, puis **départage configurable** (voir ci-dessous). |
| Jeu du défi | Défi contre un élève à au plus *n* rangs locaux. On ne peut pas lancer un défi si l'un des deux élèves est déjà engagé. Avec la permutation activée, le défiant vainqueur prend la place du défié (rang local rejoué après chaque correction). |
| Montante-descendante individuelle | 2 élèves par terrain (3 sur le dernier si l'effectif est impair). Le gagnant monte, le perdant descend ; au terrain 1, personne ne monte, et au dernier terrain, personne ne descend. |
| Montante-descendante par groupes | Mini-poule complète par terrain, avec 1 ou 2 montées et descentes. Les déplacements sont affichés (↑/↓) et ne touchent pas l'Elo. |
| Ronde suisse | Appariement exact de coût minimal (revanches évitées quand c'est possible). L'exemption va en priorité à un élève qui n'en a pas eu, avec 1 point de tournoi et 0 Elo. |
| Reclassement | Brassage en poules, puis divisions en **tableaux intégraux** (2, 4, 8, 16…) ou en poules de 3, 5 ou 6. Chaque place est attribuée une fois. Corriger un match en amont invalide les matchs en aval, après confirmation. |

## Terrains dessinés selon le sport
Les terrains sont dessinés vus de dessus, aux proportions réglementaires, selon le **sport de la classe** (Réglages) : badminton, tennis de table, pickleball, tennis, padel ; « Autre » donne un terrain neutre. Les élèves y sont **placés physiquement** :
- **séance** : joueur A à gauche du filet (pastille jaune), joueur B à droite (pastille bleu clair) ; au tennis de table, en bout de table. Les remplaçants du groupe qui ne jouent sur aucun terrain attendent « sur le banc ». Un terrain libre ou fermé (grisé, hachuré) est signalé. Toucher un nom ouvre la fiche de l'élève, et « Saisir le score » fait défiler la page jusqu'au match ;
- **projection** : les mêmes dessins en grand, avec le QR du match ;
- **groupes de travail** : tous les élèves du groupe répartis sur les deux moitiés de leur terrain.

Les identités ne reposent pas sur la couleur : chaque élève est nommé. Les cotes affichées dans la maquette de conception viennent des règlements usuels et méritent une vérification avant toute communication officielle.

## Groupes de travail
L'onglet **Groupes de travail** répartit les élèves présents sur un nombre de terrains choisi (− / +), sans créer de séance et sans toucher à l'Elo :
- **Équilibrée** (par défaut) : distribution en serpentin selon le classement Elo (1ᵉʳ → T1, 2ᵉ → T2 … dernier terrain, puis retour). Chaque terrain a un niveau moyen comparable, et l'écart entre les moyennes est affiché.
- **Par niveau** : les mieux classés au terrain 1, puis les suivants, etc.

Les effectifs diffèrent au plus d'un élève. Un appel permet d'exclure les absents. On peut déplacer un élève à la main ; ces déplacements sont conservés jusqu'à la prochaine répartition. Les groupes sont mémorisés avec la classe et peuvent être imprimés.

## Fiche élève
La fiche s'ouvre dans une **fenêtre** (pop-up) quand on touche le nom d'un élève, depuis le classement, la liste des élèves ou les groupes de travail. Elle se ferme avec ✕, avec la touche Échap ou en touchant le fond.

## QR codes : autonomie des élèves sur tablette
Les données restent **sur l'appareil de l'enseignant**, sans serveur. Les résultats passent donc par un aller-retour de QR codes :
1. **QR du match.** Il s'affiche sur l'appareil de l'enseignant (bouton « QR » d'un terrain, ou « QR de la feuille de match » dans les actions d'un match) et, si la case est cochée, sur chaque terrain en **projection**.
2. **Feuille de match.** L'élève scanne le QR avec l'appareil photo de sa tablette. Une page s'ouvre avec les noms, le terrain, le score cible et de grands boutons + / −. La tablette n'enregistre **aucune donnée de la classe**, seulement le score en cours de ce match (conservé si la page se recharge).
3. **Code de résultat.** En fin de match (« Terminer le match » ou « Forfait »), la tablette affiche un QR de résultat et un code court lisible, par exemple `RE1.K3Q9ZD.8V2MXA.11.4.7QJ0B2C`.
4. **Mode scan.** L'enseignant ouvre « 📷 Mode scan » : une petite fenêtre avec l'aperçu de la caméra lit le QR présenté. Le code peut aussi être tapé ou dicté ; la saisie tolère minuscules, O/0 et I/L/1. Le résultat est vérifié, enregistré, puis signalé par un bip, avec un bouton « Annuler cette saisie ». On peut aussi décocher « Enregistrer dès la lecture » pour valider chaque résultat à la main.

### Poules classiques en autonomie : une feuille pour toute la poule
En poules classiques, chaque poule a son **QR de poule** : bouton « QR poule n » dans la séance, et affichage en projection si la case est cochée. La tablette ouvre alors une **feuille de poule** avec **tous les matchs de la poule**.
- Pour chaque match : grands boutons + / −, « Valider ce match » ou « Forfait ».
- Un mini-classement des victoires est mis à jour en direct. Les scores sont conservés si la page se recharge.
- À la fin, « Terminer la poule » affiche **un seul QR de résultat** pour toute la poule, par exemple `RP1.3ATA1R.0.11:1,2:11,FB,4:11,11:5,6:11.04F8SC0`. Ce code contient un élément par match, dans l'ordre : score A:B, `FA` ou `FB` pour un forfait, `-` pour un match non joué.
- Le mode scan reconnaît ce code et **enregistre tous les résultats d'un coup**. Les matchs non joués sont ignorés et les résultats identiques laissés tels quels ; un résultat différent d'un score déjà saisi demande une confirmation.
- Une poule de 6 en aller-retour (30 matchs) tient dans un QR de version 14 pour le lien et de version 9 pour le résultat.

Contrôles appliqués au scan :
- le code doit appartenir à la séance en cours et au bon match ;
- une **empreinte de contrôle**, calculée avec un jeton propre à la séance, rejette les codes mal recopiés ou modifiés (c'est une vérification, pas un chiffrement) ;
- scanner deux fois le même code ne change rien ;
- un résultat différent d'un score déjà saisi demande une confirmation ;
- les conséquences en aval (tableaux de reclassement) sont confirmées comme pour une saisie manuelle.

Conditions :
- les tablettes doivent ouvrir l'application par son **adresse web**, par exemple l'adresse Vercel (Réglages → QR codes) ;
- l'aperçu caméra du mode scan exige une page en `https` ;
- les QR codes sont dessinés par **`qr.js`**, un générateur écrit pour l'application (norme ISO/IEC 18004, mode octets UTF-8, correction d'erreur M, versions 1 à 20), sans dépendance ;
- la **lecture** par la caméra utilise le lecteur intégré du navigateur (`BarcodeDetector` : Chrome sur Android, Chromebook, Mac). Ailleurs (iPad, Windows), on tape le code texte affiché sous le QR de la tablette.

Vérification du générateur : 67 QR (versions 1 à 20, les 8 masques, accents et émojis, liens de feuille de match, codes de résultat) ont été décodés à l'identique par un décodeur indépendant (OpenCV). Les QR affichés dans l'application (fenêtre du professeur et tablette) ont aussi été décodés à partir de captures d'écran. `tests/qr.test.js` vérifie le calcul Reed-Solomon sur le vecteur de référence de la norme et fige ces sorties validées.

## Classe exemple (pour tester)
Le bouton **Classe exemple** (en haut, ou sur l'écran d'accueil) crée une classe de 4 à 40 élèves **fictifs** (pseudonymes d'animaux, aucun nom réel). On peut y ajouter 0 à 12 séances déjà jouées.

Les séances simulées passent par le vrai moteur : appel avec 0 à 2 absents, placement, matchs, terrains, clôture. Elles parcourent les 6 formats (poules, ronde suisse, montante-descendante par groupes, reclassement, montante-descendante individuelle, défi), à une semaine d'intervalle. Seuls les scores sont tirés au hasard, selon un niveau caché propre à chaque élève, pour que l'Elo et les graphiques se différencient.

La classe porte la mention « données fictives » sur le tableau de bord, la liste des élèves et le classement. Elle se supprime comme n'importe quelle classe (Réglages → Supprimer).

## Départage dans les groupes
Il s'applique aux poules, à la montante-descendante et aux poules de reclassement. On classe d'abord par victoires, puis on applique, au choix lors de la création de la séance :
- confrontation directe, puis différence de points, puis points marqués (par défaut) ;
- différence, puis points marqués, puis confrontation directe ;
- différence, puis points marqués.

La **confrontation directe** compte les victoires dans les matchs entre les seuls ex aequo, ce qui fait un mini-classement à 3 ex aequo ou plus. Chaque critère ne départage que les élèves encore à égalité ; en dernier recours, c'est l'ordre de départ validé. La colonne « Départagé par » indique le critère qui sépare un élève de celui classé juste devant lui. Les séances créées avec la V1 gardent leur ancien départage (différence, puis points).

## Mode projection
Dans la séance, le bouton **📺 Mode projection** ouvre une seconde fenêtre (même page, adresse terminée par `#projection`) à afficher au vidéoprojecteur :
- terrains en très grand, puis matchs « À suivre » ;
- pour la montante-descendante, placement de la rotation avec ↑/↓ ;
- plein écran avec la touche F.

La fenêtre est **en lecture seule**. Elle se met à jour toute seule, sous 2 secondes, à chaque saisie faite dans la fenêtre principale. Elle **n'affiche jamais l'Elo ni les statistiques**. Le classement de la séance n'est projeté que si l'enseignant coche « Projeter aussi le classement de la séance ».

## Graphiques d'évolution
La fiche élève présente deux graphiques SVG, en plus du tableau qui reste disponible :
- l'**Elo** séance par séance, avec une ligne pointillée pour l'Elo initial ;
- le **rang dans la classe**, la 1ʳᵉ place en haut.

Les points creux marquent les séances d'absence. Une info-bulle s'affiche au survol, et les flèches du clavier parcourent les points quand le graphique a le focus. Les deux mesures sont sur deux graphiques séparés (jamais de double axe).

## Corrections par rapport au prototype V1
1. Annuler une séance **rouverte** la supprimait définitivement : elle est maintenant restaurée.
2. Poules et groupes : tout le surplus d'élèves s'entassait dans le dernier groupe (avec 24 élèves sur 4 terrains en groupes de 4, une poule de 12 et 66 matchs). Les groupes sont maintenant équilibrés.
3. Le placement affiché à la validation ne correspondait pas aux groupes réellement générés. C'est désormais le même.
4. Les terrains étaient attribués d'avance à tous les matchs, d'où des matchs simultanés sur un même terrain ou pour un même élève. Ils sont maintenant attribués dynamiquement.
5. Ronde suisse : l'appariement prenait à chaque fois le premier adversaire disponible, d'où des revanches évitables. L'exemption n'était ni équitable ni enregistrée (elle était écrasée à chaque ronde).
6. La montante-descendante par groupes ne faisait jouer qu'une paire par joueur au lieu d'une mini-poule.
7. Le reclassement n'attribuait aucun classement intégral.
8. Jeu du défi : saisie par fenêtres `prompt()`, aucun contrôle des matchs simultanés, aucune permutation.
9. Sauvegarde :
   - version du format, migration automatique des données V1 (même clé `racket_eps_v1`) ;
   - copie de secours avant chaque enregistrement ;
   - erreurs de stockage plein signalées ;
   - import validé (élèves inconnus, doublons, plusieurs séances actives).
10. Forfaits : aucune règle n'existait ; la politique est maintenant définie (voir plus haut).

## Tests
```bash
npm test          # moteur : Elo, invariance d'ordre, conservation, absences, forfaits, corrections,
                  # 7 variantes de formats × 5/6/7/12/24/25 élèves × 1/2/3/6 terrains, migration V1
npm run test:e2e  # navigateur (Playwright à installer séparément) : ordinateur + téléphone + migration V1
```

## Limites connues
- Les durées de séance et de rotation ne sont pas gérées : seul le nombre de rotations est réglable.
- La projection se synchronise sur le même appareil (deux fenêtres du même navigateur), pas entre deux appareils différents.
- Données stockées sur l'appareil uniquement, sans synchronisation.
