.PHONY: install migrate run test lint fmt

# Install development dependencies (run inside the active venv).
install:
	pip install -r requirements-dev.txt

migrate:
	python manage.py migrate

run:
	python manage.py runserver

test:
	pytest

lint:
	ruff check .

fmt:
	ruff format .
