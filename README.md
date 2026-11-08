# Projets EPS

| Dossier | Contenu |
|---|---|
| [`racket-eps/`](racket-eps/) | **Application principale**, publiée sur Vercel : suivi d'un cycle de raquette par classe, appel, terrains, 5 formats de tournoi, classement Elo. Cahier des charges : [`racket-eps/CLAUDE.md`](racket-eps/CLAUDE.md). |
| [`tournoi-eps/`](tournoi-eps/) | Tournoi de sport de raquette : brassage et tableaux à classement intégral (application web statique, hors ligne). Moteur testé (brassage suisse, tableaux à classement intégral, terrains) destiné à être réutilisé dans Racket EPS. Voir son [README](tournoi-eps/README.md). |

L'application de planning extrascolaire « Périsco » qui occupait ce dépôt est conservée dans l'historique Git (commit `5215d75`).

## Déploiement Vercel
`vercel.json` (racine) publie le dossier `racket-eps/` tel quel, sans installation ni build ; `.vercelignore` exclut ses tests. Pour publier un autre dossier (par exemple `tournoi-eps/`), changer `outputDirectory`.
