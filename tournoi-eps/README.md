# Tournoi EPS — brassage et classement intégral

Application web pour piloter, dans un gymnase, un tournoi de sport de raquette (badminton, tennis de table, pickleball, tennis, padel) en **simple** : une phase de **brassage** (rondes inspirées du système suisse) puis des **tableaux à classement intégral** qui attribuent **chaque place de 1 à N exactement une fois**.

- 100 % statique : HTML, CSS et JavaScript, sans framework, sans serveur, sans compilation obligatoire.
- Fonctionne **hors ligne** et en ouverture locale (`file://`), sans compte ni collecte de données.
- Sauvegarde automatique dans le navigateur (`localStorage`), export/import JSON, exports CSV, impression.

## Démarrer

| Usage | Fichier |
|---|---|
| Le plus simple : un seul fichier à copier sur une clé USB ou à envoyer | `tournoi-eps.html` (version autonome) |
| Développement / hébergement (GitHub Pages, Vercel, serveur statique) | `index.html` + `engine.js` + `app.js` + `style.css` |

Les deux versions fonctionnent en double-cliquant sur le fichier : les scripts sont des scripts classiques (pas de modules ES), donc aucune restriction du mode `file://`. La version autonome est régénérée par `node tools/build-standalone.js` (ou `npm run standalone`).

> Les données sont stockées **dans le navigateur de l'appareil**. Changer de navigateur, d'appareil ou vider les données du site les fait disparaître : exportez une **sauvegarde JSON** à la fin de chaque séance. En navigation privée, l'application vous prévient que rien n'est conservé.

## Parcours

1. **Configuration** : nom, sport, date, terrains, nombre de rondes, format (durée ou score cible), joueurs (un par ligne, collage multiligne ou import CSV : première colonne). Doublons (insensibles aux majuscules et accents) et lignes vides sont signalés. Le récapitulatif annonce les matchs, les vagues et une **durée estimée**.
2. **Brassage** : la ronde 1 est tirée au sort (graine reproductible) ou suit les têtes de série ; les terrains libres sont affectés automatiquement. Touchez un match pour saisir le score. La ronde suivante se génère quand la ronde est terminée.
3. **Tableaux** : après la dernière ronde, l'application **propose des divisions** (tailles, matchs par joueur, durée, avertissements) et montre qui va où. L'enseignant **confirme** avant de figer les têtes de série.
4. **Terrains** : vue lisible de loin (option « Grand texte », plein écran) avec les matchs en cours, la file d'attente et les joueurs au repos.
5. **Classement** : places finales, rang de brassage, parcours en tableau, exports CSV/JSON, impression.

## Choix algorithmiques

### Brassage
- **Points de match** : victoire 1, nul ½ (seulement si l'option est activée), défaite 0. **Exemption** : 1 point de match par défaut (paramétrable à 0), mais elle n'est **ni une victoire ni des points marqués** et n'entre pas dans la force des adversaires.
- **Départage**, dans l'ordre, affiché dans l'application avec le critère qui sépare chaque joueur du précédent :
  1. points de match ;
  2. différence de points **moyenne** par match avec score ;
  3. points marqués moyens ;
  4. force des adversaires (moyenne de leurs points de match) ;
  5. tête de série initiale (si l'option est activée) ;
  6. tirage reproductible dérivé de la graine.

  Les moyennes évitent de pénaliser un joueur exempté ou arrivé en retard. Limites : avec 3 rondes, les critères 2 à 4 sont peu discriminants, et la différence de points dépend du format (durée ou score cible).
- **Appariements** (ronde 2 et suivantes) : appariement parfait de **coût minimal**, recherche exacte par séparation et évaluation :
  `coût = 1000 × rencontres déjà jouées + 10 × (écart de points de match)² + |écart de rang|`.
  La forte pénalité garantit **qu'aucune paire n'est répétée s'il existe une alternative** (vérifié par force brute dans les tests). Au-delà d'un très grand budget de recherche, la meilleure solution trouvée est conservée et l'interface le signale.
- **Exemption** (effectif impair) : priorité aux joueurs qui n'en ont pas eu, puis à ceux qui ont joué le plus de matchs, puis aux moins bien classés ; parmi ces candidats, on retient celui qui permet le meilleur appariement.
- Les rondes s'enchaînent **sans chevauchement** : la ronde suivante n'est générée qu'une fois la précédente terminée. Si les terrains manquent, la ronde se joue en vagues successives.

### Tableau intégral (N = 2^k)
Construction récursive : un groupe de m joueurs jouant pour les places [a, a+m−1] dispute m/2 matchs ; les **vainqueurs** jouent ensuite pour [a, a+m/2−1], les **perdants** pour [a+m/2, a+m−1] ; à m = 2, le match attribue directement deux places. Chaque joueur dispute log2(N) matchs et le tableau compte N·log2(N)/2 matchs (8 → 12, 16 → 32, 32 → 80). Le premier tour suit le placement classique des têtes de série (1-8, 4-5, 2-7, 3-6). **Les joueurs des tours suivants ne sont jamais écrits à l'avance** : ils sont recalculés à partir des résultats réels via les références `sourceA` / `sourceB` (vainqueur ou perdant d'un match source).

### N quelconque : divisions de classement (mode retenu)
Les joueurs sont répartis, dans l'ordre du classement de brassage, en **divisions** de taille 2, 4, 8, 16, 32 ou 64 (tableau intégral), ou de taille 3, 5 ou 6 (**poule** tous contre tous, signalée comme « plus un tableau intégral pur »). Exemples : 24 → 8+8+8 (recommandé) ou 16+8 ; 6 → 3+3 ; 28 → 8+8+8+4 ; 36 → 8+8+8+8+4. Une répartition personnalisée est possible.

Les propositions sont classées par un score qui pénalise l'écart du nombre de matchs entre divisions, le nombre de divisions, les poules (surtout les grandes), les divisions de 2 et un trop faible nombre moyen de matchs. **L'application avertit toujours** :
- qu'un joueur d'une division ne peut pas finir devant un joueur d'une division supérieure, même s'il gagne tout ;
- lorsque le nombre de matchs diffère selon la division ;
- lorsqu'une poule est utilisée.

Le mode « tableau avec exemptions » demandé comme alternative **n'est pas implémenté** : il n'a pas encore de définition formelle prouvée (voir Limites).

Les poules se classent par victoires, puis par confrontations entre ex aequo, différence, points marqués et rang du brassage ; leurs places ne sont attribuées qu'une fois tous les matchs joués.

### Ordonnancement
États d'un match : `pending` (en attente de ses sources), `ready`, `in_progress` (sur un terrain), `completed`. La génération des matchs est séparée de leur planification. Un match prêt est affecté à un terrain libre si **aucun de ses joueurs n'est déjà sur un terrain** ; la priorité va au tour le moins avancé, puis aux joueurs qui attendent depuis le plus longtemps. L'affectation manuelle est validée (terrain occupé, joueur occupé, match non prêt). On ne peut pas supprimer un terrain sur lequel un match est en cours.

### Corrections et cohérence
- **Tableau** : corriger un score sans changer le vainqueur n'a aucune conséquence. Si le vainqueur change, la liste des **résultats aval invalidés** est affichée et une **confirmation** est demandée. Ces matchs passent ensuite en « Résultat invalidé — à rejouer », l'ancien score restant consultable. Le classement ne contient alors que des places cohérentes.
- **Brassage** : si la ronde suivante est générée mais pas jouée, elle est régénérée après confirmation. Si elle est déjà jouée, elle est conservée avec un avertissement (les appariements avaient été calculés avec l'ancien classement). Une fois les têtes de série figées, le brassage est verrouillé ; le bouton « Rouvrir le brassage » supprime les tableaux, après confirmation.

### Joueurs, forfaits, abandons
- **Forfait** pour un match : victoire pour l'adversaire, sans points marqués ni encaissés.
- **Retrait** (abandon) : le joueur n'est plus apparié au brassage. Ses matchs non joués, en brassage comme en tableau, sont perdus par forfait automatique. S'il est retiré avant la formation des divisions, il est placé en dernière tête de série. Il **conserve une place** au classement final : chaque joueur figure une fois et une seule. La réintégration annule les forfaits automatiques.
- **Retardataire** : ajout possible pendant le brassage, entre deux rondes uniquement. Il part avec 0 point ; les départages par moyennes limitent l'effet de son retard.
- Les paramètres qui changeraient les appariements (têtes de série, graine, nuls, exemption, liste des joueurs) sont **verrouillés** après le démarrage. « Réinitialiser les matchs » (double confirmation) remet le tournoi en configuration en gardant joueurs et paramètres.

## Déploiement Vercel
Site statique **sans build**. Le `vercel.json` à la racine du dépôt sert ce dossier (`outputDirectory: "tournoi-eps"`), sans installation ni compilation ; `.vercelignore` exclut les tests, les outils et `package.json`. Chaque fusion sur `main` est déployée automatiquement par l'intégration GitHub de Vercel.

## Données et persistance
- Schéma versionné (`schemaVersion: 1`, voir `engine.js`) ; chaque enregistrement conserve la version précédente comme **copie de secours**, restaurée automatiquement si la sauvegarde principale est illisible.
- Les erreurs de quota sont signalées par un bandeau avec un bouton d'export immédiat. Une modification depuis un autre onglet est détectée et signalée.
- L'import JSON est validé (version, identifiants, références) ; en cas de conflit d'identifiant, on choisit entre remplacer le tournoi ou l'importer comme copie.
- Les identifiants sont stables (`P1`, `M12`, `DA`…) ; les noms ne servent jamais de clé.
- Les CSV utilisent le séparateur `;` et un BOM UTF-8 pour s'ouvrir correctement dans un tableur français.

## Tests

```bash
npm test            # = node --test tests/*.test.js — logique pure, sans dépendance
npm run test:e2e    # parcours navigateur (nécessite Playwright installé à part)
```

Les tests automatisés couvrent :
- tableaux de 4, 8, 16 et 32 joueurs (nombre de matchs, un match par tour et par joueur, places 1..N, liens vainqueur/perdant, structure détaillée du tableau de 8) ;
- 6, 10, 12, 24, 25, 28 et 36 joueurs avec les partitions proposées (classement complet, avertissements présents) ;
- 1, 2, 3, 6 et 10 terrains (jamais de terrain ou de joueur en double, simulation complète avec affectation automatique) ;
- exemptions équitables avec un effectif impair, absence de paire répétée tant qu'une alternative existe ;
- validation des scores (nul, négatif, décimal, vide) ;
- corrections avec invalidation en aval et régénération de ronde ;
- forfaits, abandons, retardataires, doublons ;
- sauvegarde, rechargement et import JSON, exports CSV, estimation de durée.

Le parcours navigateur (`tests/e2e/parcours.js`) reproduit le scénario d'acceptation sur **ordinateur et téléphone** : 24 joueurs, 6 terrains, 3 rondes, 3 divisions de 8 (36 matchs), saisie via l'arbre et la vue Terrains, places 1 à 24, rechargement à l'identique, correction amont, exports, aucun débordement horizontal.

## Limites connues
- **Format simple uniquement.** Le modèle (joueurs = participants, matchs à deux camps) est prévu pour accueillir le double, mais un classement *individuel* en double n'est pas équivalent et n'est pas proposé.
- **Score en un seul nombre par joueur** (points d'un match en durée limitée ou à score cible). Les matchs en plusieurs sets ne sont pas gérés : saisir le total de points ou le nombre de sets gagnés, de façon cohérente pour tout le tournoi.
- Le mode « tableau avec exemptions » n'est pas proposé. Pour les effectifs non découpables en puissances de 2, on utilise des poules de 3, 5 ou 6, clairement signalées.
- Un tableau intégral donne un rang exhaustif, **pas une mesure parfaite du niveau** : les frontières de divisions dépendent de quelques rondes de brassage.
- Les données restent sur l'appareil : pas de synchronisation entre plusieurs tablettes.

## Structure

```
index.html              page (charge engine.js puis app.js)
engine.js               moteur pur et testable (appariements, classements, tableaux, terrains, persistance)
app.js                  interface (rendu, saisie, arbre SVG, exports)
style.css               styles responsive, mode sombre, impression
tournoi-eps.html        version autonome générée
tools/build-standalone.js
tests/*.test.js         tests de logique (node --test)
tests/e2e/parcours.js   parcours navigateur (Playwright)
CLAUDE.md               cahier des charges
(vercel.json et .vercelignore sont à la racine du dépôt)
```
