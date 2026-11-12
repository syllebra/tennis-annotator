PY := uv run
FRONT := frontend

.PHONY: help sync build serve dev test test-py test-js fixtures e2e check schema launcher clean

help:
	@grep -E '^[a-z-]+:.*?##' Makefile | sed 's/:.*##/\t: /'

sync:  ## installe les dépendances Python et Node
	uv sync
	cd $(FRONT) && npm install

build:  ## build le frontend dans frontend/dist
	cd $(FRONT) && npm run build

serve: build  ## lance l'application sur http://127.0.0.1:8001
	$(PY) python -m cli.main serve

dev:  ## backend (8001) + vite (5173) — lancer dans deux terminaux
	@echo "terminal 1: uv run python -m cli.main serve"
	@echo "terminal 2: cd frontend && npm run dev"

test: test-py test-js  ## toute la suite

test-py:
	$(PY) python -m pytest -q

test-js:
	cd $(FRONT) && npx tsc --noEmit && npm test

fixtures:  ## régénère les fixtures de conformité Python <-> TypeScript
	$(PY) python scripts/gen_fixtures.py

launcher:  ## installe la commande globale `tennis-annotator` + entrée de menu
	./scripts/install-launcher.sh

e2e:  ## smoke test navigateur (serveur requis sur :8011, Chromium installé)
	cd $(FRONT) && node tests/e2e.smoke.mjs http://127.0.0.1:8011

check:  ## valide les sidecars d'un dossier
	$(PY) python -m cli.main check $(DIR)

schema:  ## régénère docs/annotations.schema.json
	cd backend && $(PY) python -m app.schema_export

clean:
	rm -rf $(FRONT)/dist $(FRONT)/node_modules .pytest_cache
	find . -name __pycache__ -prune -exec rm -rf {} +
