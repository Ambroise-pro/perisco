# CLAUDE.md — Tournoi EPS : brassage et classement intégral

## 1. Mission
Tu es Claude Code, développeur principal d'une application web pédagogique pour les professeurs d'EPS. Construis, teste et maintiens une application de gestion de tournois de sports de raquettes (badminton, tennis de table, pickleball, tennis, padel), en français, qui combine une phase de brassage et des tableaux à classement intégral.

**Priorités absolues :** exactitude des appariements et des classements, temps de jeu équitable, simplicité de saisie sur mobile, fonctionnement hors ligne, protection contre la perte de données.

## 2. Contexte du dépôt et consignes de travail
- Un prototype initial peut être présent sous le nom `tournoi_eps.html`. Commence par lire son code et relever ses fonctionnalités et limites avant de le modifier.
- Ne considère jamais le prototype comme une spécification correcte : corrige les erreurs de logique, en particulier les tableaux incomplets, les exemptions et les classements.
- Implémente directement les changements demandés, sans introduire de dépendances ni de compilation si ce n'est pas nécessaire.
- Explique les décisions algorithmiques importantes dans le code et dans un `README.md`.
- Ne déclare pas une fonctionnalité terminée avant de l'avoir testée.
- Ne supprime pas de données de tournoi sans confirmation explicite.

## 3. Contraintes techniques
- HTML5, CSS3 et JavaScript moderne (ES modules facultatifs), **sans React, Vue, serveur ni build obligatoire**.
- Hébergement statique compatible GitHub Pages, Vercel ou simple ouverture locale du fichier HTML.
- Responsive et tactile ; interface en français ; accessibilité de base (labels, focus, contrastes, navigation clavier).
- Persistance locale via `localStorage`, avec schéma versionné et gestion des erreurs/quota. Prévoir export/import JSON pour sauvegarde et transfert.
- Aucune connexion, aucun compte et aucune collecte de données personnelles.
- Aucun appel externe nécessaire pour les fonctionnalités essentielles. Si des fichiers JS/CSS séparés sont utilisés, documenter les limites du mode `file://` et proposer une version HTML autonome.
- Éviter les noms d'élèves réels dans les données de démonstration.

## 4. Paramètres configurables
- Nom du tournoi, sport, date, noms des joueurs (saisie manuelle, collage multiligne, import CSV facultatif).
- Nombre de joueurs : dynamique, sans valeur codée en dur ; gérer notamment 6, 8, 12, 16, 24, 28, 32 et 36 joueurs.
- Nombre de terrains : dynamique, de 1 à un nombre pertinent ; ne jamais programmer plus d'un match simultané par terrain ou plus d'un match simultané par joueur.
- Format initial : **simple (1 contre 1)**. Prévoir une architecture extensible au double, sans prétendre que le classement individuel en double est identique.
- Nombre de rondes de brassage (par défaut 3), durée cible des matchs ou score cible, règles de victoire et départage.
- Option de têtes de série (classement initial connu) ou tirage aléatoire reproductible à partir d'une graine.
- Paramètres verrouillés après le début des matchs lorsqu'une modification casserait la cohérence ; proposer une réinitialisation explicite et confirmée.

## 5. Parcours utilisateur
1. Créer ou reprendre un tournoi.
2. Renseigner les paramètres et la liste des joueurs ; vérifier doublons et noms vides.
3. Afficher un récapitulatif des effectifs, terrains et matchs prévus.
4. Générer le brassage ; afficher les matchs disponibles par terrain et les joueurs en attente.
5. Saisir les scores, corriger un résultat, suivre l'avancement.
6. À la fin de chaque ronde, calculer le classement provisoire et générer la ronde suivante.
7. Après toutes les rondes de brassage, afficher les résultats et **demander confirmation avant de figer les têtes de série**.
8. Générer les tableaux de classement intégral ; affecter les terrains aux matchs prêts.
9. Saisir les résultats jusqu'à attribution de toutes les places.
10. Afficher et exporter le classement final, les résultats et les statistiques.

## 6. Algorithme de brassage
Objectif : rencontrer des adversaires variés, avec une opposition progressivement équilibrée.

- Ronde 1 : tirage équilibré selon les têtes de série, si elles existent ; sinon tirage aléatoire avec graine.
- Rondes suivantes : appariement inspiré du système suisse, selon points de match, puis départages, en évitant autant que possible les rencontres répétées.
- Construire une liste de paires candidates et minimiser une fonction de coût documentée : répétition d'adversaire (forte pénalité), différence de points/classement, déséquilibre du nombre de matchs et des exemptions.
- Pour les effectifs impairs, attribuer une exemption équitable : priorité aux joueurs n'en ayant pas eu, puis aux joueurs ayant joué davantage. Une exemption ne doit jamais être confondue avec une victoire sportive ; préciser son traitement dans le classement.
- Tous les joueurs doivent avoir un nombre de matchs aussi proche que possible ; ne jamais générer deux matchs simultanés pour un même joueur.
- Si les terrains sont moins nombreux que les matchs d'une ronde, organiser celle-ci en vagues successives. La ronde suivante ne commence qu'une fois la précédente terminée, sauf mode avancé explicitement conçu et testé.
- Prévoir un départage stable et affiché : points de match, différence de points marqués/encaissés, points marqués, puis indicateur de force des adversaires si disponible, et enfin tirage reproductible en cas d'égalité parfaite. Documenter l'ordre et les limites de chaque critère.
- Les résultats modifiés doivent recalculer les classements ; si des rondes ultérieures existent, empêcher les incohérences et demander une régénération contrôlée.

## 7. Classement intégral : exigences mathématiques
Un tableau intégral doit attribuer **chaque place finale exactement une fois**. Un perdant continue dans la branche de classement correspondant à son parcours ; il n'est jamais éliminé de la compétition.

### Cas idéal : N = 2^k
- Construire un arbre de classement complet avec k matchs par joueur et N*k/2 matchs au total.
- Exemple N=8 : quarts (4 matchs), demi-finales des branches hautes et basses (4 matchs), puis finales pour 1-2, 3-4, 5-6 et 7-8 (4 matchs), soit 12 matchs.
- N=16 : 32 matchs ; N=32 : 80 matchs.
- Les branches doivent être calculées à partir des **résultats effectifs**, jamais de noms ou d'indices supposés.
- Afficher à chaque match les places en jeu, ses prérequis et son terrain lorsqu'il est affecté.

### Cas général : N non puissance de 2
**Ne pas promettre un classement intégral équitable avec un tableau fictif de taille supérieure et des exemptions mal gérées.** Proposer deux modes :

**Mode recommandé — divisions de classement :**
- À partir du classement de brassage, répartir les joueurs en divisions de tailles puissances de 2 lorsque c'est possible (par exemple 24 joueurs = division A de 16, division B de 8 ; ou 3 divisions de 8, au choix de l'enseignant).
- Dans chaque division, organiser un tableau intégral complet. Les places globales correspondent aux rangs de la division (A : 1 à 16 ; B : 17 à 24).
- Avertir explicitement que les frontières de divisions sont fixées par le brassage : un joueur de division B ne peut pas finir devant un joueur de division A, même s'il gagne tous ses matchs.
- Ne pas imposer une partition arbitraire : montrer les divisions proposées, leurs tailles et les conséquences sur le nombre de matchs.

**Mode alternatif — tableau avec exemptions :**
- À développer seulement avec une définition formelle et des tests prouvant l'unicité de chaque rang, la validité des branches et le traitement des matchs non joués.
- Afficher les écarts éventuels de nombre de matchs par joueur ; ne pas présenter ce mode comme parfaitement équitable.

Si aucune partition satisfaisante n'est disponible (ex. effectifs impairs), proposer explicitement des solutions : une division à poule de classement, une ronde de placement supplémentaire, ou une exemption contrôlée. L'interface doit indiquer clairement lorsque le format n'est plus un tableau intégral pur.

## 8. Ordonnancement et terrains
- Séparer la génération des rencontres de leur planification sur les terrains.
- Un match est `pending`, `ready`, `in_progress` ou `completed` ; seuls les matchs dont tous les participants sont connus peuvent être prêts.
- Affecter automatiquement les terrains libres, sans chevauchement de joueur ; permettre une affectation manuelle validée.
- Afficher : terrain, adversaires, score, état, prochaine rencontre, attente éventuelle.
- Favoriser l'équité des temps de repos, sans bloquer indéfiniment un tableau.
- Enregistrer les scores au fur et à mesure ; confirmer la fin d'un match et autoriser la correction avec gestion des conséquences en aval.

## 9. Classements et statistiques
- Brassage : rang provisoire, matchs joués, victoires, défaites, exemptions, points marqués/encaissés, différence, adversaires rencontrés.
- Phase finale : division, chemin dans le tableau, place attribuée.
- Classement final : **tous les joueurs une fois et une seule**, rangs continus de 1 à N, aucune place manquante ou dupliquée.
- Afficher la distinction entre classement du brassage et place finale.
- Exports : CSV (compatible tableur), JSON complet, impression/PDF via feuille de style `@media print` ; ne pas ajouter de dépendance PDF sans besoin réel.
- Ne pas confondre taux de victoires et classement final du tableau.

## 10. Interface attendue
Écrans ou onglets :
- **Configuration** : paramètres et joueurs.
- **Brassage** : rondes, matchs, scores, classement provisoire.
- **Tableaux** : divisions, branches gagnants/perdants, matchs de classement, progression.
- **Terrains** : vue plein écran lisible en gymnase, avec rencontres en cours et suivantes.
- **Classement** : tableau final et statistiques, export/impression.

Concevoir pour la saisie rapide d'un enseignant debout dans un gymnase : grands boutons, peu de clics, couleurs non indispensables à la compréhension, pas de fenêtres modales inutiles, confirmations pour actions destructrices.

### Exigence prioritaire : arbre de classement intégral interactif

**Cette fonctionnalité est obligatoire, pas une image décorative.** Ajouter dans l'onglet **Tableaux** une représentation graphique fidèle au principe du tableau intégral : matchs initiaux à gauche, branches des gagnants et perdants vers la droite, puis matchs de classement de toutes les places. Utiliser le schéma 8 joueurs comme référence de lecture : quarts Q1 à Q4 ; demi-finales gagnants pour places 1-4 ; demi-finales perdants pour places 5-8 ; finale 1-2, match 3-4, match 5-6 et match 7-8. **Afficher aussi les deux matchs 3-4 et 7-8 dans l'arbre**, et pas seulement en légende.

- Chaque noeud de match affiche le numéro, les deux noms (ou « En attente du match X »), le score, le terrain, le statut et, quand disponible, le gagnant.
- Chaque arête a un sens précis : qualification du gagnant ou du perdant d'un match source. Ne jamais tracer des connexions ambiguës ni inventer un adversaire avant qu'il soit connu.
- Code couleur cohérent : bleu pour les matchs initiaux, vert pour la branche haute, orange pour la branche basse. Ajouter des libellés/traits pleins ou pointillés pour que la compréhension ne dépende pas de la couleur seule.
- Un clic ou toucher sur un noeud ouvre la saisie/édition du résultat ; après validation, mettre à jour instantanément les deux branches et les places déterminées.
- Le graphe doit provenir du **même modèle de données** que les matchs, les terrains et le classement ; aucune copie de logique ou résultats fictifs dans l'interface réelle.
- Pour 24 joueurs répartis en 3 divisions de 8 après brassage, proposer un sélecteur **Tableau A (places 1-8), B (9-16), C (17-24)**. Les trois arbres sont complets et indépendants, avec conversion correcte des places locales en rangs globaux.
- Pour les autres effectifs, afficher autant de divisions que nécessaire, selon la partition retenue ; ne jamais masquer les matchs de classement ni attribuer artificiellement des places.
- Affichage responsive : sur mobile, conteneur défilant horizontalement avec zoom +/−, recentrage et taille tactile suffisante ; sur tablette/ordinateur, vue d'ensemble et possibilité de plein écran. Prévoir impression lisible (éventuellement en paysage) et export SVG/PNG si faisable sans dépendance.
- Implémentation recommandée : SVG natif pour les arêtes et cartes de matchs synchronisées, ou SVG intégral ; pas de canvas opaque non accessible. Déterminer la disposition par les dépendances du graphe, sans coordonnées codées en dur pour un seul effectif.
- États obligatoires : avant le début, en cours, terminé, match en attente de ses sources, forfait, exemption, résultat invalidé après modification d'un match amont.
- Une modification d'un résultat amont doit invalider explicitement les résultats descendants concernés, avec confirmation avant suppression ; jamais laisser un arbre et un classement contradictoires.
- Afficher au-dessus de l'arbre une mini-légende « Gagnants / Perdants » et le nombre de places déjà attribuées.

**Tests d'acceptation supplémentaires de la vue graphique :**
1. Avec 8 joueurs, le graphe comporte exactement 12 noeuds de matchs, dont 4 quarts, 4 demi-finales de classement et 4 matchs de classement final (1-2, 3-4, 5-6, 7-8).
2. Chaque joueur apparaît dans exactement un match par tour, et tous les liens gagnant/perdant mènent au bon noeud.
3. Un score saisi dans un quart fait apparaître automatiquement son gagnant et son perdant dans les branches correspondantes.
4. Le résultat de chacun des quatre matchs finaux attribue exactement deux places distinctes.
5. Sur 24 joueurs en trois tableaux de 8, les 36 matchs produisent les rangs 1 à 24 sans trou ni doublon.
6. Sur écran étroit, aucun noeud n'est inaccessible ; zoom, défilement, sélection tactile et saisie restent fonctionnels.
7. Le graphe reste cohérent après sauvegarde/rechargement et après correction d'un score amont.

## 11. Modèle de données indicatif
```js
{
  schemaVersion: 1,
  tournament: { id, name, sport, date, seed, settings, phase },
  players: [{ id, name, initialSeed }],
  rounds: [{ id, phase, number, matchIds, status }],
  divisions: [{ id, name, playerIds, globalRankStart, format }],
  matches: [{
    id, phase, roundId, divisionId, courtId,
    playerAId, playerBId, sourceA, sourceB,
    scoreA, scoreB, winnerId, loserId, status,
    targetRanks, createdAt, completedAt
  }],
  finalStandings: [{ playerId, rank, divisionId }]
}
```
Les champs `sourceA` et `sourceB` décrivent les matchs antérieurs et la règle de progression (`winner` ou `loser`). Utiliser des identifiants stables, pas les noms, comme clés de référence.

## 12. Tests obligatoires
Créer des tests automatisés de logique pure, exécutables sans framework complexe si possible. Vérifier au minimum :
- N=4, 8, 16 et 32 : exactement N places finales distinctes ; chacun dispute log2(N) matchs ; total N*log2(N)/2.
- N=6, 12, 24, 28 et 36 : partition de divisions documentée, pas de rang manquant, pas de joueur oublié ; aucune affirmation trompeuse sur l'équité.
- 1, 2, 3, 6 et 10 terrains : aucun double emploi d'un terrain ou d'un joueur simultanément.
- Brassage avec nombre impair : exemptions réparties équitablement.
- Aucune paire répétée si une alternative valide existe.
- Scores nuls/égaux/interdits selon les règles : validation explicite.
- Changement d'un score déjà enregistré : aucun résultat aval silencieusement incohérent.
- Sauvegarde, rechargement, export et import JSON sans perte de données.
- Doublons de noms, liste vide, ajout/retrait de joueurs, abandon et forfait : comportement documenté et testé.
- Tests de parcours utilisateur sur téléphone et ordinateur ; impression lisible.

## 13. Critères d'acceptation
Une séance réelle doit pouvoir être pilotée avec 24 joueurs et 6 terrains :
1. Ajouter 24 joueurs et configurer 3 rondes de brassage.
2. Générer des rencontres sans conflits, les répartir sur les 6 terrains.
3. Saisir tous les résultats et obtenir un classement provisoire explicable.
4. Former par exemple trois divisions de 8, confirmées par l'enseignant.
5. Générer 12 matchs par division, soit 36 matchs de classement au total.
6. Attribuer sans ambiguïté les places 1 à 24, sans doublons.
7. Recharger la page et retrouver le tournoi au même état.
8. Exporter un classement CSV et une sauvegarde JSON.

## 14. Ordre d'implémentation
1. Auditer le prototype et écrire une courte liste de bugs/écarts.
2. Extraire un moteur de tournoi pur et testable (appariements, classements, arbre, planification).
3. Écrire les tests de propriété/invariants avant de complexifier l'interface.
4. Construire l'interface responsive et la persistance.
5. Ajouter exports et impression.
6. Tester des tournois simulés complets et les cas limites.
7. Documenter l'utilisation dans `README.md` et livrer une version autonome facile à ouvrir.

## 15. Règles de réponse de Claude Code
- Quand une demande est ambiguë, adopter un comportement prudent et documenter l'hypothèse ; poser une question seulement si le choix change profondément le fonctionnement.
- Signaler les compromis pédagogiques : un tableau intégral donne un rang exhaustif, mais pas nécessairement une estimation parfaite du niveau sportif.
- Après chaque changement important, indiquer les fichiers modifiés, les tests exécutés, leurs résultats et les limites restantes.
- Ne jamais annoncer qu'un classement est fiable si l'algorithme n'a pas été vérifié.
