# ⭐ Punktekonto

Mit dieser Familien-App sammeln die Kinder Punkte für Haushalt, Hausaufgaben, Instrument üben usw. und tauschen sie gegen Medienzeit (Standard: **1 Punkt = 1 Minute**) oder andere Belohnungen ein.

- Läuft im Browser auf Handy, Tablet und PC und lässt sich zum Homescreen hinzufügen
- Alle Geräte sind live synchron
- Mit einem Eltern-PIN sehen die Kinder ihre Punkte, aber nur die Eltern können buchen. Optional dürfen die Kinder auch selbst buchen
- **Updates per Knopfdruck:** Unter *Einstellungen → App-Version & Updates* holt die App die neue Version per `git pull` und startet sich neu
- Keine npm-Abhängigkeiten. Die Daten liegen in `data/state.json`

## Installation (Docker)

```bash
git clone <DEIN-REPO-URL> punktekonto
cd punktekonto
docker compose up -d --build
```

Die App läuft dann unter `http://<server-ip>:8080`.

> Wichtig: Der Code wird als Ordner in den Container eingebunden (`./:/app`), nicht ins Image kopiert. Nur so kann die App sich selbst aktualisieren. `restart: unless-stopped` sorgt dafür, dass sie nach dem Update automatisch neu startet.

### Private Repos

- **HTTPS mit Token:** `git clone https://<token>@github.com/<user>/punktekonto.git`. Das Token muss nur Leserechte haben (Fine-grained Token, *Contents: read*).
- **SSH:** In `docker-compose.yml` die Zeile `~/.ssh:/root/.ssh:ro` aktivieren.

## Workflow für Änderungen

1. Den Code ändern (lokal oder mit Claude), dann `git commit` und `git push`
2. In der App *Einstellungen → Nach Updates suchen*: Sie zeigt die neuen Commits an
3. Auf *Jetzt aktualisieren* tippen. Nach ein paar Sekunden lädt die App neu

Das Update ist ein `git merge --ff-only`. Hast du auf dem Server selbst etwas am Code geändert, bricht das Update ab, statt etwas zu überschreiben. Punkte und Einstellungen in `data/` sind von Git ausgenommen und bleiben beim Update erhalten.

> Ändert sich nur das `Dockerfile` (z. B. eine neue Node-Version), reicht der Knopf nicht. Dann einmal `docker compose up -d --build` ausführen.

## Ohne Docker

```bash
node server.js          # Node 18+, Port per PORT=8080
```

Damit der Neustart nach einem Update klappt, sollte ein Dienst wie systemd den Prozess bei einem Exit automatisch neu starten (`Restart=always`).

## Backup

Es reicht, `data/state.json` zu sichern.
