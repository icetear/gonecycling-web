"""Smoke test of the start page (map + navbar + trips/tours + modals)."""
from django.test import Client


def test_home_renders_map_navbar_and_planner():
    res = Client().get("/")
    assert res.status_code == 200
    body = res.content.decode()
    # Map + MapLibre + app module + Bootstrap theme.
    assert 'id="map"' in body
    assert "maplibre" in body.lower()
    assert "js/app.js" in body
    assert "bootstrap" in body.lower()
    # Offline-first: trips AND tours are always in the navbar.
    assert 'id="btn-trips"' in body
    assert 'id="btn-touren"' in body
    # Tours UI + roundtrip + optional sync.
    assert 'id="tours-offcanvas"' in body
    assert 'id="roundtrip-modal"' in body
    assert 'id="connect-modal"' in body
    assert "nicht verbunden mit GoneCycling App" in body
