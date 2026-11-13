"""Simple token protection for the local interface.

A random token is generated on first start and stored in
``~/.config/tennis-annotator/auth.json`` (mode 0600).  A successful login sets
an HttpOnly cookie whose value is an expiry timestamp signed with
HMAC-SHA256 keyed by the token itself, so sessions survive restarts and
changing the token invalidates every existing session.

This is a shared-secret gate for a single-user local tool, not an account
system: anyone able to read the token file can enter, and it does not encrypt
the traffic.  It exists so the interface is not open to whatever else can reach
the port (another local process, a tunnel, a misconfigured bind).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import time
from pathlib import Path

from .config import CONFIG_DIR

COOKIE_NAME = "tauth"
SESSION_SECONDS = 30 * 24 * 3600
AUTH_FILE = CONFIG_DIR / "auth.json"


class AuthGate:
    def __init__(self, path: Path | None = None) -> None:
        self.token: str = ""
        self._secret: bytes = b""
        self.required = True
        self.created = False
        self.path: Path = path or AUTH_FILE
        self.configure()

    # -- token storage -------------------------------------------------
    def configure(self) -> None:
        from_env = os.environ.get("TENNIS_ANNOTATOR_TOKEN", "").strip()
        if from_env:
            self.token = from_env
            self.created = False
        elif self.path.is_file():
            try:
                data = json.loads(self.path.read_text(encoding="utf-8"))
                token = str(data.get("token") or "").strip()
            except (json.JSONDecodeError, OSError):
                token = ""
            if token:
                self.token = token
            else:
                self._generate()
        else:
            self._generate()
        self._secret = hashlib.sha256(self.token.encode("utf-8")).digest()

    def _generate(self) -> None:
        self.token = secrets.token_urlsafe(32)
        self.created = True
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(
                json.dumps({"token": self.token, "created": int(time.time())}, indent=2) + "\n",
                encoding="utf-8",
            )
            os.chmod(self.path, 0o600)
        except OSError:
            # Still usable for this process; the token is printed at startup.
            pass

    # -- sessions ------------------------------------------------------
    def check_token(self, value: str | None) -> bool:
        if not value:
            return False
        return secrets.compare_digest(value, self.token)

    def new_session(self, expires_in: int = SESSION_SECONDS) -> str:
        expires = int(time.time()) + expires_in
        payload = str(expires)
        mac = hmac.new(self._secret, payload.encode("utf-8"), hashlib.sha256).hexdigest()
        return f"{payload}.{mac}"

    def valid_session(self, value: str | None) -> bool:
        if not value or "." not in value:
            return False
        payload, mac = value.split(".", 1)
        try:
            if int(payload) < time.time():
                return False
        except ValueError:
            return False
        expected = hmac.new(self._secret, payload.encode("utf-8"), hashlib.sha256).hexdigest()
        return hmac.compare_digest(mac, expected)

    def attach(self, response) -> None:
        response.set_cookie(
            COOKIE_NAME,
            self.new_session(),
            max_age=SESSION_SECONDS,
            httponly=True,
            samesite="lax",
            path="/",
        )

    def clear(self, response) -> None:
        response.delete_cookie(COOKIE_NAME, path="/")


def login_page(error: str = "") -> str:
    message = (
        f'<p class="error">{error}</p>' if error else ""
    )
    return f"""<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tennis Annotator — accès</title>
<style>
  :root {{ color-scheme: dark; }}
  body {{
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: #0d1117; color: #e6edf3;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  }}
  form {{
    width: min(360px, 88vw); background: #161b22; border: 1px solid #30363d;
    border-radius: 12px; padding: 24px; display: flex; flex-direction: column; gap: 12px;
  }}
  h1 {{ font-size: 16px; margin: 0 0 4px; }}
  p {{ margin: 0; font-size: 12.5px; color: #8b949e; line-height: 1.5; }}
  input {{
    background: #1c2128; border: 1px solid #30363d; border-radius: 6px;
    padding: 9px 10px; font-size: 14px; color: inherit;
  }}
  input:focus {{ outline: 2px solid #58a6ff; border-color: transparent; }}
  button {{
    background: #1f6f43; border: 1px solid #7ee787; border-radius: 6px;
    padding: 9px 10px; font-size: 14px; color: #fff; cursor: pointer;
  }}
  button:hover {{ background: #238636; }}
  .error {{ color: #ff7b72; }}
  code {{ font-family: ui-monospace, monospace; font-size: 11px; color: #8b949e; }}
</style>
</head>
<body>
  <form method="post" action="/api/auth/login" autocomplete="off">
    <h1>Tennis Annotator</h1>
    <p>Interface protégée. Colle le token affiché au démarrage du serveur.</p>
    <input type="password" name="token" placeholder="token d’accès" autofocus required>
    {message}
    <button type="submit">Entrer</button>
    <p>Token : <code>~/.config/tennis-annotator/auth.json</code></p>
  </form>
</body>
</html>
"""


auth = AuthGate()
