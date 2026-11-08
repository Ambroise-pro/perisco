# Racket EPS — Instructions de développement pour Claude Code / Codex

## Objectif
Développer et maintenir une application web en français pour l'EPS permettant de suivre les élèves sur un cycle de sports de raquettes (badminton, tennis de table, pickleball, tennis, padel). À chaque séance, l'enseignant choisit un format de tournoi, saisit les scores et suit les statistiques et le classement Elo de chaque élève.

## Projet existant
- `index.html` : prototype V1 monofichier (HTML, CSS, JavaScript natif).
- `CLAUDE.md` : cahier des charges, règles métier et consignes pour les prochaines évolutions.
- Ouvrir `index.html` dans un navigateur pour tester. Aucun build ni serveur n'est requis pour la V1.
- Les données sont stockées localement dans le navigateur. Prévoir des exports réguliers : effacer les données du navigateur peut les supprimer.
- Ne pas présenter la V1 comme testée exhaustivement : vérifier les algorithmes et cas limites avant usage réel.

## Contraintes techniques
- Conserver une application responsive, utilisable sur téléphone, tablette, ordinateur et vidéoprojecteur.
- Préférer HTML/CSS/JavaScript sans framework ni étape de compilation ; hébergement statique GitHub Pages / Vercel.
- Préserver les données déjà sauvegardées ; versionner le schéma et fournir une migration si nécessaire.
- Aucun service externe obligatoire ; fonctionnement hors connexion après chargement si un service worker est ajouté.
- Interface intégralement en français, accessible (clavier, contraste, zones tactiles).
- Données d'élèves : minimisation, pas de publication ni de partage sans action explicite ; ne pas inclure de données réelles dans les jeux de test.

## Règles métier obligatoires
1. Classes et cycles distincts ; effectifs, sports, terrains et formats configurables.
2. Appel à chaque séance. Un absent ne joue aucun match et conserve son Elo ; il réintègre le classement à son retour.
3. Début de cycle : Elo initial de 1000 pour tous, sauf configuration explicite de l'enseignant.
4. L'Elo est FIXE pendant toute une séance. Chaque match terminé et validé contribue séparément à la variation Elo ; tous les calculs utilisent les Elo de DÉBUT de séance des deux adversaires.
5. Formule : `E_A = 1 / (1 + 10 ** ((R_B - R_A) / 400))`, `delta_A = K * (S_A - E_A)` avec `S_A=1` en cas de victoire, `0` en cas de défaite. Calculer symétriquement B. K par défaut : 32, paramétrable.
6. À la clôture : additionner toutes les variations par joueur, puis appliquer les nouveaux Elo simultanément. L'ordre de saisie des scores ne doit jamais changer le résultat.
7. Conserver la précision des Elo en mémoire ; arrondir seulement à l'affichage.
8. Les points marqués et encaissés, la différence de points, le taux de victoires et les adversaires distincts sont des statistiques séparées ; le score exact n'influence pas l'Elo classique.
9. Ne pas attribuer d'Elo pour un match annulé, non terminé, un forfait administratif ou une exemption sans résultat sportif validé. Définir explicitement la politique des forfaits.
10. Le classement Elo général du cycle est distinct du classement provisoire du tournoi de la séance.
11. Avant la séance suivante, proposer automatiquement les terrains dans l'ordre du classement Elo, en retirant les absents. L'enseignant peut échanger/déplacer des élèves et DOIT valider la répartition avant de générer les matchs. Ces déplacements ne changent pas l'Elo.
12. À la fin de séance, l'enseignant valide les résultats puis clôture le calcul Elo. Une correction ultérieure doit permettre un recalcul chronologique déterministe des séances suivantes, sans double comptage.
13. Gérer les égalités de classement de façon stable et explicite ; conserver les identifiants uniques des élèves même si leurs noms changent.

## Formats de tournoi à implémenter complètement
### A. Poules classiques
- Poules de 3 à 6 élèves, aller simple ou aller-retour.
- Classement local : victoires, puis départages configurables (confrontation directe, différence de points, points marqués).
- Répartition selon les terrains et les présents ; limiter les matchs simultanés à la capacité physique.

### B. Jeu du défi
- Défis contre des joueurs proches du rang local, écart maximal configurable.
- Règle de permutation locale configurable ; conserver toutes les rencontres pour l'Elo.
- Empêcher les matchs simultanés d'un même élève et suivre les adversaires déjà rencontrés.

### C. Montante-descendante — DEUX variantes
- **Individuelle** : 2 élèves par terrain ; le gagnant monte et le perdant descend à chaque rotation, avec gestion explicite des terrains extrêmes.
- **Par groupes** : 3 à 6 élèves par terrain ; mini-poules ou mini-tournois rapides ; 1 ou 2 montants/descendants selon les effectifs et règles choisies.
- Durée ou nombre de rotations configurable ; affichage visuel des déplacements et gestion des égalités.
- Les déplacements pendant la séance sont des positions de tournoi, pas des modifications de l'Elo.

### D. Ronde suisse
- Nombre de rondes configurable ; appariement selon les points de tournoi et critères de départage.
- Éviter autant que possible les rematches ; traiter les effectifs impairs avec exemptions équitables.
- Ne pas attribuer de variation Elo aux exemptions.

### E. Tournoi avec reclassement
- Phase de brassage optionnelle, puis tableaux de classement ; gagnants et perdants continuent de jouer.
- Produire autant que possible un classement intégral de toutes les places.
- Prévoir les effectifs non puissances de 2, les byes, les matchs de placement et les contraintes de terrains.

## Vues attendues
- Tableau de bord : classes, cycle actif, séance, synthèse.
- Gestion des élèves : import en masse, modification, absences.
- Terrains : représentation fidèle du nombre de terrains, élèves positionnés, mouvements proposés, validation obligatoire.
- Séance : choix du tournoi, réglages, rondes, matchs, saisie rapide des scores, corrections.
- Classement général : Elo, variation depuis la séance précédente, victoires/défaites, points, matchs joués.
- Fiche élève : évolution Elo et rang par séance, scores, adversaires rencontrés, historique, taux de victoires, points pour/contre, absences.
- Historique : séances clôturées, réouverture contrôlée, export.
- Mode projection : terrains et matchs lisibles à distance, sans exposer plus de données que nécessaire.

## Fiabilité et tests à ajouter
- Tests unitaires de la formule Elo et de la somme des variations sur plusieurs matchs.
- Test d'invariance à l'ordre de saisie ; test de conservation de la somme des Elo sur des matchs binaires sans arrondis intermédiaires.
- Test d'absence, d'exemption, de match incomplet, de doublon, de correction et de recalcul des séances suivantes.
- Tests de chaque format avec 5, 6, 7, 12, 24, 25 élèves et 1, 2, 3, 6 terrains ; vérifier qu'un élève ne joue jamais deux matchs simultanés.
- Tests d'import/export JSON et de compatibilité des anciennes sauvegardes.
- Vérification mobile, ordinateur, navigation clavier, impression/projection.

## Priorités de développement
1. Auditer le prototype V1 et corriger les bugs de sauvegarde, d'affectation et de clôture Elo.
2. Isoler un moteur de tournoi testable, distinct de l'interface, sans imposer de build.
3. Finaliser les cinq formats, notamment les deux montantes-descendantes et le reclassement intégral.
4. Renforcer les fiches statistiques et les graphiques d'évolution séance par séance.
5. Ajouter un mode projection et des exports CSV/JSON fiables.

## Méthode de travail demandée à l'agent
- Lire `index.html` avant toute modification ; ne pas réécrire aveuglément les fonctions existantes.
- Expliquer brièvement les fichiers modifiés et les règles métier affectées.
- Après chaque changement, tester le scénario complet : créer une classe → faire l'appel → proposer/valider les terrains → générer les matchs → saisir les scores → clôturer → vérifier l'Elo → ouvrir la séance suivante.
- Ne jamais inventer de résultats d'élèves ni modifier silencieusement des séances clôturées.
- Signaler clairement toute fonctionnalité encore simulée ou partiellement implémentée.
