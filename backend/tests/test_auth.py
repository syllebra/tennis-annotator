import hashlib
import stat

import pytest
from fastapi.testclient import TestClient

from app.auth import AuthGate, login_page
from app.main import app


def test_token_is_generated_and_persisted(tmp_path, monkeypatch) -> None:
    monkeypatch.delenv("TENNIS_ANNOTATOR_TOKEN", raising=False)
    path = tmp_path / "auth.json"
    gate = AuthGate(path)
    assert gate.created is True
    assert len(gate.token) >= 32
    assert path.is_file()
    assert stat.S_IMODE(path.stat().st_mode) == 0o600

    second = AuthGate(path)
    assert second.created is False
    assert second.token == gate.token


def test_env_token_overrides_and_skips_file(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("TENNIS_ANNOTATOR_TOKEN", "from-env")
    path = tmp_path / "auth.json"
    gate = AuthGate(path)
    assert gate.token == "from-env"
    assert gate.created is False
    assert not path.exists()


def test_session_roundtrip_and_expiry() -> None:
    gate = AuthGate.__new__(AuthGate)
    gate.token = "abc"
    gate._secret = hashlib.sha256(b"abc").digest()
    cookie = gate.new_session()
    assert gate.valid_session(cookie)
    expired = gate.new_session(expires_in=-10)
    assert not gate.valid_session(expired)
    assert not gate.valid_session(cookie[:-1] + ("0" if cookie[-1] != "0" else "1"))
    assert not gate.valid_session("garbage")
    assert not gate.valid_session(None)


def test_check_token() -> None:
    gate = AuthGate.__new__(AuthGate)
    gate.token = "secret-token"
    assert gate.check_token("secret-token")
    assert not gate.check_token("secret-tokeN")
    assert not gate.check_token("")
    assert not gate.check_token(None)


def test_login_page_has_a_form() -> None:
    page = login_page()
    assert 'action="/api/auth/login"' in page
    assert 'name="token"' in page
    assert "auth.json" in page
    assert "Token invalide." in login_page("Token invalide.")


def test_api_requires_auth() -> None:
    client = TestClient(app)
    assert client.get("/api/videos").status_code == 401
    assert client.get("/api/auth/status").json()["authenticated"] is False


def test_login_sets_cookie_and_unlocks_api() -> None:
    client = TestClient(app)
    response = client.post("/api/auth/login", json={"token": "test-token"})
    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert client.get("/api/videos").status_code == 200
    assert client.get("/api/auth/status").json()["authenticated"] is True


def test_bad_token_is_rejected() -> None:
    client = TestClient(app)
    assert client.post("/api/auth/login", json={"token": "nope"}).status_code == 401


def test_html_is_gated_and_token_auto_login() -> None:
    client = TestClient(app, follow_redirects=False)
    page = client.get("/")
    assert page.status_code == 200
    assert 'action="/api/auth/login"' in page.text

    redirect = client.get("/?token=test-token")
    assert redirect.status_code == 303
    assert redirect.headers["location"] == "/"
    assert "tauth" in redirect.cookies

    # the cookie now opens the application shell
    shell = client.get("/")
    assert shell.status_code == 200
    assert 'action="/api/auth/login"' not in shell.text


def test_token_query_rejects_invalid_token() -> None:
    client = TestClient(app, follow_redirects=False)
    response = client.get("/?token=wrong")
    assert response.status_code == 401
    assert "Token invalide." in response.text


def test_logout_clears_the_session() -> None:
    client = TestClient(app)
    client.post("/api/auth/login", json={"token": "test-token"})
    assert client.get("/api/videos").status_code == 200
    client.post("/api/auth/logout")
    assert client.get("/api/videos").status_code == 401


def test_form_login_redirects() -> None:
    client = TestClient(app, follow_redirects=False)
    response = client.post(
        "/api/auth/login",
        data={"token": "test-token"},
        headers={"accept": "text/html"},
    )
    assert response.status_code == 303
    assert "tauth" in response.cookies
