#!/usr/bin/env bash
# Installe le lanceur global : commande `tennis-annotator` + entrée de menu.
#
#   scripts/install-launcher.sh            # ~/.local
#   scripts/install-launcher.sh --uninstall
set -euo pipefail

APP_DIR="$(cd -- "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")/.." && pwd)"
BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"
APPS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
ICONS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/scalable/apps"
DESKTOP_FILE="$APPS_DIR/tennis-annotator.desktop"
ICON_FILE="$ICONS_DIR/tennis-annotator.svg"
LINK="$BIN_DIR/tennis-annotator"

if [ "${1:-}" = "--uninstall" ]; then
  rm -f "$LINK" "$DESKTOP_FILE" "$ICON_FILE"
  command -v update-desktop-database >/dev/null && update-desktop-database "$APPS_DIR" 2>/dev/null || true
  printf 'Lanceur désinstallé.\n'
  exit 0
fi

mkdir -p "$BIN_DIR" "$APPS_DIR" "$ICONS_DIR"
ln -sfn "$APP_DIR/bin/tennis-annotator" "$LINK"
install -m 644 "$APP_DIR/assets/tennis-annotator.svg" "$ICON_FILE"

cat > "$DESKTOP_FILE" <<DESKTOP
[Desktop Entry]
Type=Application
Version=1.0
Name=Tennis Annotator
Comment=Annoter des vidéos de tennis : court et trajets de balle
Exec=$LINK
Icon=tennis-annotator
Terminal=false
Categories=AudioVideo;
Keywords=tennis;annotation;vidéo;ball;
StartupNotify=true
DESKTOP

command -v update-desktop-database >/dev/null && update-desktop-database "$APPS_DIR" 2>/dev/null || true
command -v gtk-update-icon-cache >/dev/null &&
  gtk-update-icon-cache -f -t "${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor" 2>/dev/null || true

printf 'Commande : %s\n' "$LINK"
printf 'Menu     : %s\n' "$DESKTOP_FILE"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) printf '\n⚠ %s n’est pas dans le PATH ; ajoute-le à ton shell.\n' "$BIN_DIR" ;;
esac

# Vérifie que le lanceur est exécutable et que son aide répond.
if [ -x "$LINK" ] && "$LINK" --help >/dev/null 2>&1; then
  printf '\nPrêt : lance « tennis-annotator » ou cherche « Tennis Annotator » dans le menu.\n'
else
  printf '\n⚠ Le lanceur ne répond pas ; vérifie %s\n' "$LINK" >&2
  exit 1
fi
