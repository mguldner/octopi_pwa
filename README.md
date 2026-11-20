# octopi_pwa

PWA mobile-first pour surveiller et piloter une imprimante OctoPrint depuis un réseau local.

## Architecture

Le dépôt contient :

- une PWA statique installable ;
- un serveur local Node.js qui sert de passerelle vers l’API OctoPrint ;
- une découverte légère des instances sur le sous-réseau local ;
- une configuration locale qui conserve la clé API avec des permissions `0600`.

La clé API n’est jamais envoyée au navigateur. Utilisez une clé OctoPrint dédiée et restreinte.

## Démarrage

```bash
npm install
npm start
```

Ouvrir `http://<hôte>:3000`. Sur un Raspberry Pi, utiliser plutôt son adresse réseau locale.

Variables utiles :

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `PORT` | `3000` | Port du service |
| `HOST` | `0.0.0.0` | Interface d’écoute |
| `DATA_DIR` | `./data` | Stockage de configuration |
| `TLS_CERT` | — | Certificat PEM pour HTTPS |
| `TLS_KEY` | — | Clé privée PEM pour HTTPS |

## HTTPS et installation PWA

Une PWA installable nécessite HTTPS en dehors de `localhost`. Pour une installation locale approuvée :

```bash
sudo apt install mkcert
mkcert -install
mkcert octopi-pwa.local 192.168.1.50
TLS_CERT=./octopi-pwa.local+1.pem \
TLS_KEY=./octopi-pwa.local+1-key.pem \
npm start
```

Installez puis approuvez le certificat sur chaque appareil mobile avant d’ouvrir l’application.
Ajoutez éventuellement une entrée DNS locale pour le nom utilisé par le certificat.

## Découverte

La découverte vérifie `octopi.local`, `octoprint.local` et les hôtes du sous-réseau IPv4 via `/api/version`.
Après sélection, renseignez la clé API OctoPrint. La configuration reste sur le service compagnon.