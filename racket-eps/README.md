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
qrdecode.js  lecteur de QR codes (sans dépendance) — window.RacketQRDecode
sw.js        cache pour le fonctionnement hors connexion
manifest.webmanifest, icons/   installation sur l'écran d'accueil
tests/       tests du moteur et du générateur QR (node --test), parcours navigateur (Playwright)
```

## Hors connexion et installation
Le Wi-Fi des gymnases est souvent mauvais.
- Une fois ouverte **par son adresse web** (Vercel), l'application garde une copie locale d'elle-même (`sw.js`) : elle se rouvre **sans réseau**, et les feuilles de match et de poule s'ouvrent aussi sur les tablettes élèves.
- La règle est « réseau d'abord » : en ligne, on reçoit toujours la dernière version ; si le réseau est absent ou met plus de 3 s à répondre, c'est la copie locale qui sert.
- Les données des élèves ne passent jamais par ce cache : elles restent dans le stockage du navigateur.
- L'application est **installable** sur l'écran d'accueil (`manifest.webmanifest`, icônes dans `icons/`) : sur iPad, Partager → « Sur l'écran d'accueil » ; sur Android, menu → « Installer l'application ». Une fois installée, elle s'ouvre en plein écran et ses données sont mieux protégées (Safari peut effacer les données des sites non installés qu'on n'a pas ouverts depuis longtemps).
- En ouverture locale (`file://`), le hors connexion ne s'applique pas.

## Lecture des QR sur tous les appareils
Le mode scan utilise le lecteur de QR intégré au navigateur quand il existe (Chrome sur Android, Chromebook, Mac). Sinon, notamment sur **iPad et Windows**, il utilise **`qrdecode.js`**, un lecteur écrit pour l'application, sans dépendance :
- seuillage local de l'image, puis recherche des trois motifs de repérage (vérifiés en croix) ;
- taille du code mesurée le long de ses vrais axes, puis correction de la perspective, avec le 4ᵉ coin calé sur le motif d'alignement ;
- lecture des modules par vote sur 5 points ;
- correction d'erreurs Reed-Solomon (Berlekamp-Massey, Chien, Forney) ;
- plusieurs seuils et plusieurs triplets de motifs sont essayés si nécessaire.

Il lit les QR produits par l'application (niveau de correction M, versions 1 à 20). Le reste ne lui est pas destiné.

Mesures (`tests/qrdecode.test.js`, plus un balayage de 300 prises de vue simulées à angle quelconque, inclinaison jusqu'à 25 %, bruit, flou, modules de 3 à 8 px) :
- 96 % de réussite par image pour les codes de résultat, 99 % pour les codes de poule et les feuilles de poule ;
- environ 8 ms par image de 640 × 480 ;
- les échecs restants combinent des modules minuscules (3–4 px) et un bruit fort. En pratique, la caméra fournit plusieurs images par seconde : il suffit d'approcher la tablette.

Le parcours navigateur filme un vrai QR de poule avec une caméra simulée et vérifie que la poule s'enregistre toute seule.

## Sauvegardes et transfert
- **Rappel** : après chaque clôture, une pastille sur le bouton de sauvegarde (en haut) et un bandeau sur l'accueil indiquent le nombre de séances non sauvegardées. « Sauvegarder maintenant » télécharge le fichier ; « Partager… » ouvre le menu de partage de la tablette quand il existe (AirDrop, ENT, messagerie). Les classes exemples ne déclenchent pas de rappel.
- **Export d'une seule classe** (Réglages), pour passer sur un autre appareil.
- **Import par fusion** : les classes du fichier sont **ajoutées**. Pour une classe déjà présente, on choisit de la remplacer, de garder les deux ou de l'ignorer ; les autres classes ne sont jamais touchées. Une copie de secours est faite avant l'import.

## Tester cet appareil
Réglages → « Tester cet appareil » vérifie sur la tablette :
- l'enregistrement local et l'espace disponible ;
- la protection contre l'effacement, avec un bouton pour la demander ;
- le fonctionnement hors connexion et l'installation sur l'écran d'accueil ;
- le lecteur de QR utilisé, avec un **test de la caméra** sur un QR de l'application ;
- l'écran et l'adresse utilisée dans les QR.

L'écran propose aussi un **protocole d'essai en classe** de 15 minutes, à suivre avant la première vraie séance.

## Interface pensée pour la tablette
L'application se pilote principalement **au toucher, avec de gros boutons**, sur une tablette tenue à l'horizontale.
- **Barre de navigation en bas**, à portée de pouce : Accueil, Séance, Groupes, Classement, Élèves. L'Historique, la sauvegarde (export JSON) et les Réglages sont des boutons-icônes en haut à droite. La classe se choisit avec le grand bouton en haut à gauche.
- **Accueil** : un très grand bouton « Lancer la séance » (ou « Reprendre »), le podium Elo et des tuiles vers les autres écrans.
- **Nouvelle séance sans clavier** : le format se choisit sur de grandes cartes, les rondes et l'écart de défi se règlent avec − / +, les autres options sont des boutons à choix unique (élèves par groupe, score cible, variante, matchs, départage). La date utilise le sélecteur natif.
- **Appel au toucher** : une tuile par élève ; un toucher le marque absent (barré, bordure pointillée, croix), un second le remet présent. Le décompte s'affiche en direct, avec un bouton « Tous présents ».
- **Saisie du score en grand panneau**, sans champ numérique :
  - on y accède en touchant le terrain dessiné, ou par « Saisir le score » sur un terrain ou un match ;
  - boutons − / + de 88 px, et un bouton « X gagne : 11 » qui met directement le score cible ;
  - la validation est bloquée en cas d'égalité, avec un rappel de jouer le point décisif ;
  - « Plus… » donne accès au forfait, au QR et à l'effacement.
- **Zones tactiles** de 52 à 100 px, texte à partir de 17 px, contrastes renforcés (boutons principaux vert d'eau sur texte sombre). Les états ne reposent jamais sur la couleur seule.

Le clavier ne sert plus qu'à saisir les noms des élèves, une fois par classe (collage d'une liste possible), et à la saisie manuelle d'un code de résultat quand la caméra ne lit pas les QR.

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

## Répartition des poules par niveau Elo
En poules classiques (et en brassage du reclassement), l'écran d'appel propose une **répartition automatique** :
- **Par niveau Elo** (par défaut) : élèves rangés selon leur Elo, poule 1 = meilleurs Elo, puis les suivants ; chacun joue contre des adversaires de son niveau.
- **Poules équilibrées** : serpentin selon l'Elo, chaque poule a un niveau moyen comparable.

Le nombre d'élèves par poule (3 à 6) se change sur le même écran, et l'Elo moyen de chaque poule est affiché. « ↻ Répartir automatiquement selon l'Elo » annule les déplacements manuels. Si les poules sont déjà lancées mais qu'aucun résultat n'est saisi, « ↻ Refaire les poules par niveau Elo » ramène à l'appel pour les reformer.

## Groupes de travail
L'onglet **Groupes de travail** répartit les élèves présents sur un nombre de terrains choisi (− / +), sans créer de séance et sans toucher à l'Elo :
- **Équilibrée** (par défaut) : distribution en serpentin selon le classement Elo (1ᵉʳ → T1, 2ᵉ → T2 … dernier terrain, puis retour). Chaque terrain a un niveau moyen comparable, et l'écart entre les moyennes est affiché.
- **Par niveau** : les mieux classés au terrain 1, puis les suivants, etc.

Les effectifs diffèrent au plus d'un élève. Un appel permet d'exclure les absents. On peut déplacer un élève à la main ; ces déplacements sont conservés jusqu'à la prochaine répartition. Les groupes sont mémorisés avec la classe et peuvent être imprimés.

## Évaluations AFL
Chaque classe suit des AFL (par défaut AFL1, AFL2, AFL3 ; liste modifiable dans Réglages).
- **Évaluer** : touchez la pastille d'un AFL (liste des élèves ou fiche). Une fenêtre s'ouvre : choisissez le **degré 1 à 4** au toucher et, si vous le souhaitez, une **petite note justifiant le degré** (200 caractères), une par AFL évalué. La date du jour est enregistrée. Toucher à nouveau la pastille permet de modifier ou de **retirer** l'évaluation.
- **Filtrer** : dans Élèves et dans Classement, choisissez l'AFL puis « Tous », « ✓ Évalués » ou « À évaluer » (avec les effectifs). Le classement filtré garde les vrais rangs. Le filtre choisi est mémorisé sur l'appareil.
- La fiche élève récapitule degré, date et note de chaque AFL ; l'export CSV du classement ajoute date, degré et note par AFL. Les évaluations n'ont aucun effet sur l'Elo et sont incluses dans les sauvegardes.

## Plein écran
Le bouton ⛶ de l'en-tête passe toute l'application en plein écran (et en sort). Il est masqué sur les navigateurs qui ne le permettent pas (iPhone notamment) ; sur iPad/Android, l'installation sur l'écran d'accueil donne aussi un affichage sans barre d'adresse.

## Fiche élève
La fiche s'ouvre dans une **fenêtre** (pop-up) quand on touche le nom d'un élève, depuis le classement, la liste des élèves ou les groupes de travail. Elle se ferme avec ✕, avec la touche Échap ou en touchant le fond.

## Comment fonctionne l'Elo
- Chaque élève commence le cycle à 1000 (réglable). Après chaque match, le vainqueur prend des points au perdant : ce que l'un gagne, l'autre le perd.
- Le gain dépend de l'écart d'Elo : battre un mieux classé rapporte beaucoup, battre un moins bien classé rapporte peu. Un match vaut au maximum K points (32 par défaut), et 16 entre deux élèves de même Elo.
- Exemple (K = 32) : 1100 contre 1000. Si le 1100 gagne : +12 / −12. Si le 1000 gagne : +20 / −20.
- Pendant une séance, l'Elo est figé : chaque match utilise les Elo de début de séance et les variations sont additionnées à la clôture. Le score exact, les forfaits, les exemptions et les absences ne changent pas l'Elo.
- Formule : E = 1 / (1 + 10^((Elo adverse − Elo) / 400)) ; variation = K × (résultat − E).
- Cette explication est aussi dans l'application : Classement → « Comment fonctionne l'Elo ? ».

### Enjeu affiché sur les feuilles de match
La saisie du score (enseignant), la feuille de match et la feuille de poule (tablettes des élèves) affichent pour chaque joueur son **Elo de début de séance**, les points gagnés **en cas de victoire** et perdus **en cas de défaite**.

Les **cartes de match** de la séance l'affichent aussi en version courte (« Elo 1098 · V +12 · D −20 ») ; une fois le match terminé, la carte indique la variation obtenue (« +12 à la clôture »), ou « Elo inchangé » pour un forfait.

## Elo saisi à la main
L'enseignant peut **fixer l'Elo** d'un élève quand il le souhaite (niveau connu d'avance, erreur à rattraper, élève arrivé en cours de cycle…) :
- **Depuis la fiche élève** : « ✎ Modifier l'Elo », puis boutons −50 / −10 / +10 / +50 (pas besoin du clavier), note facultative, « Enregistrer ».
- **Depuis le classement** : « ✎ Modifier les Elo » permet d'en changer plusieurs d'un coup, puis « Enregistrer » (confirmation demandée).

Un ajustement signifie « Elo fixé à X après la séance N » (N = 0 avant toute séance). Il s'insère au bon endroit de la chronologie : si une séance passée est corrigée, le recalcul le conserve à sa place, sans double comptage. Une séance déjà lancée garde les Elo de son début (l'enjeu affiché ne change pas) ; l'ajustement s'applique après sa clôture, mais apparaît tout de suite au classement. Les ajustements sont marqués ✎ dans le classement, l'historique et les graphiques, et chacun peut être annulé depuis la fiche (« Annuler cet ajustement »).

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
- en **poules classiques** : une carte par poule avec **tous ses joueurs**, le **QR code de la poule** (feuille de tous les matchs), les terrains utilisés, l'avancement et les victoires ; plus de premier match terrain par terrain ;
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
- Données stockées sur l'appareil uniquement, sans synchronisation. Le transfert entre appareils se fait par fichier (export / import par fusion).
- Le lecteur de QR maison n'a été testé que sur des images simulées et une caméra simulée : il reste à l'essayer sur une vraie tablette (voir le protocole d'essai).
- Le hors connexion suppose une première ouverture avec Internet par l'adresse web ; après une mise à jour publiée, la nouvelle version arrive à la prochaine ouverture en ligne.
