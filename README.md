# Projets EPS

| Dossier | Contenu |
|---|---|
| [`tournoi-eps/`](tournoi-eps/) | Tournoi de sport de raquette : brassage et tableaux à classement intégral (application web statique, hors ligne). Voir son [README](tournoi-eps/README.md). |

L'application de planning extrascolaire « Périsco » qui occupait ce dépôt est conservée dans l'historique Git (commit `5215d75`).

## Déploiement Vercel
`vercel.json` (à la racine) sert le dossier `tournoi-eps/` tel quel, sans installation ni build ; `.vercelignore` exclut ses tests et outils. Pour publier un autre dossier, changer `outputDirectory`.
