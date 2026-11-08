# Bibliothèques QR facultatives

`index.html` charge, s'ils sont présents, deux fichiers à placer dans ce dossier :

| Fichier attendu | Projet | Version testée | Licence | Rôle |
|---|---|---|---|---|
| `qrcode-generator.js` | [qrcode-generator](https://www.npmjs.com/package/qrcode-generator) (Kazuhiko Arase), fichier `qrcode.js` du paquet | 1.4.4 | MIT | Dessiner les QR codes (feuilles de match, résultats) |
| `jsQR.js` | [jsQR](https://www.npmjs.com/package/jsqr) (Cosmo Wolfe), fichier `dist/jsQR.js` du paquet | 1.4.0 | Apache-2.0 | Lire un QR depuis la caméra quand le navigateur n'a pas de lecteur intégré (`BarcodeDetector`), par exemple sur iPad ou sous Windows |

Sans ces fichiers, l'application fonctionne : les liens et codes texte remplacent les QR, et la caméra ne lit que sur les navigateurs dotés de `BarcodeDetector`. Ils ne font aucune requête réseau ; joindre leur licence s'ils sont ajoutés.
