# Périsco — Planning Extrascolaire

Application web statique (aucun serveur ni backend) pour interpréter le listing Excel des activités
extrascolaires/périscolaires : liste des onglets, nombre d'inscrits et noms des élèves par activité,
détection des conflits d'horaire, et planning hebdomadaire pour les activités sélectionnées.

Tout le traitement se fait dans le navigateur (via [SheetJS](https://sheetjs.com/)) : le fichier Excel
n'est jamais envoyé à un serveur.

## Utilisation en local

Ouvrez `index.html` directement dans un navigateur, ou servez le dossier avec n'importe quel serveur
statique, par ex. :

```bash
python3 -m http.server 4173
```

## Fonctionnalités

- Import d'un fichier `.xls` / `.xlsx` par clic ou glisser-déposer
- Liste des activités (onglets) avec jour, horaire, organisateur, nombre d'inscrits et liste nominative des élèves
- Recherche (activité, organisateur, élève), filtre par jour et par classe, tri
- Seuil d'alerte modifiable : rouge si inscrits < seuil, vert si inscrits ≥ seuil
- Détection automatique des conflits d'horaire (élève inscrit à deux activités qui se chevauchent)
- Planning hebdomadaire des activités sélectionnées, avec gestion des chevauchements

## Déploiement sur Vercel

Ce projet est un site 100% statique (pas de build). Sur Vercel, choisissez le preset **"Other"** —
aucune commande de build n'est nécessaire, le répertoire racine est servi tel quel.
