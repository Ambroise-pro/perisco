# Racket EPS — suivi de cycle et classement Elo

Application web pour suivre une classe pendant un cycle de sport de raquette : appel, placement sur les terrains, tournoi de la séance (5 formats), saisie des scores, classement **Elo** du cycle et fiches élèves. HTML/CSS/JS sans framework ni build ; fonctionne en ouvrant `index.html` (y compris en `file://`) ou sur un hébergement statique (Vercel).

Le cahier des charges est dans [`CLAUDE.md`](CLAUDE.md).

## Fichiers
```
index.html   page
engine.js    moteur pur et testé (Elo, formats, terrains, persistance) — window.RacketEngine
app.js       interface
style.css    styles (repris du prototype V1)
tests/       tests du moteur (node --test) et parcours navigateur (Playwright)
```

## Règles métier implémentées
- **Elo figé pendant la séance.** Chaque match validé contribue `K × (S − E)` avec les Elo de **début** de séance. Les variations sont sommées puis appliquées toutes en même temps à la clôture, donc l'ordre de saisie ne change rien. La précision est conservée en mémoire ; l'arrondi ne se fait qu'à l'affichage.
- **Recalcul chronologique.** Le classement est recalculé à partir des séances clôturées, dans l'ordre. Corriger une séance passée (Historique → Rouvrir) recalcule les séances suivantes sans double comptage. *Annuler la correction* restaure la séance d'origine.
- **Ce qui ne compte pas pour l'Elo :** match non validé, forfait, exemption, séance non clôturée. Les absents ne jouent pas et gardent leur Elo.
- **Politique des forfaits :** un forfait donne la victoire au tournoi de la séance, mais **ni Elo, ni points marqués ou encaissés**. Il est comptabilisé à part (victoires et défaites par forfait).
- **Deux classements distincts :** le classement de la séance (points de tournoi) et le classement Elo du cycle.
- **Placement :** il est proposé dans l'ordre Elo, sans les absents. L'enseignant ajuste (groupes ou ordre), puis **valide**. Le placement validé est exactement celui qui sert à générer les matchs.
- **Terrains :** un terrain accueille un seul match à la fois, et un élève ne joue jamais deux matchs simultanés. Les matchs attendent un terrain libre (file d'attente), et le terrain du groupe est privilégié quand il est libre.

## Formats
| Format | Fonctionnement |
|---|---|
| Poules classiques | Groupes équilibrés de 3 à 6 (écart ≤ 1), aller simple ou aller-retour, tours organisés par la méthode du cercle. |
| Jeu du défi | Défi contre un élève à au plus *n* rangs locaux. On ne peut pas lancer un défi si l'un des deux élèves est déjà engagé. Avec la permutation activée, le défiant vainqueur prend la place du défié (rang local rejoué après chaque correction). |
| Montante-descendante individuelle | 2 élèves par terrain (3 sur le dernier si l'effectif est impair). Le gagnant monte, le perdant descend ; au terrain 1, personne ne monte, et au dernier terrain, personne ne descend. |
| Montante-descendante par groupes | Mini-poule complète par terrain, avec 1 ou 2 montées et descentes. Les déplacements sont affichés (↑/↓) et ne touchent pas l'Elo. |
| Ronde suisse | Appariement exact de coût minimal (revanches évitées quand c'est possible). L'exemption va en priorité à un élève qui n'en a pas eu, avec 1 point de tournoi et 0 Elo. |
| Reclassement | Brassage en poules, puis divisions en **tableaux intégraux** (2, 4, 8, 16…) ou en poules de 3, 5 ou 6. Chaque place est attribuée une fois. Corriger un match en amont invalide les matchs en aval, après confirmation. |

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
- Départages des poules : différence de points, puis points marqués, puis position de départ. La confrontation directe n'est pas encore proposée.
- Les durées de séance et de rotation ne sont pas gérées : seul le nombre de rotations est réglable.
- Pas encore de mode projection dédié ni de graphiques d'évolution (priorités 4 et 5 du cahier des charges). Les fiches élèves présentent l'évolution sous forme de tableau.
- Données stockées sur l'appareil uniquement, sans synchronisation.
