#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.production"
STATE_DIR=".deploy-state"
STATE_FILE="$STATE_DIR/last_successful_image"
mkdir -p "$STATE_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Copy .env.production.example and fill values."
  exit 1
fi

PREV_IMAGE=""
if docker compose -f "$COMPOSE_FILE" ps -q app >/dev/null 2>&1; then
  APP_CID="$(docker compose -f "$COMPOSE_FILE" ps -q app || true)"
  if [[ -n "${APP_CID:-}" ]]; then
    PREV_IMAGE="$(docker inspect -f '{{.Config.Image}}' "$APP_CID" 2>/dev/null || true)"
  fi
fi

if [[ -z "$PREV_IMAGE" ]] && [[ -f "$STATE_FILE" ]]; then
  PREV_IMAGE="$(cat "$STATE_FILE")"
fi

NEW_IMAGE="sparkypalos-app:release-$(date +%Y%m%d%H%M%S)"
echo "Building $NEW_IMAGE"
docker build -t "$NEW_IMAGE" .

echo "Deploying with compose"
APP_IMAGE="$NEW_IMAGE" docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d app proxy

echo "Waiting for health check"
HEALTH_URL="http://127.0.0.1/api/health"
OK=0
for _ in {1..30}; do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    OK=1
    break
  fi
  sleep 2
done

if [[ "$OK" -eq 1 ]]; then
  echo "$NEW_IMAGE" > "$STATE_FILE"
  echo "Deployment succeeded: $NEW_IMAGE"
  exit 0
fi

echo "Deployment failed health checks."
if [[ -n "$PREV_IMAGE" ]]; then
  echo "Rolling back to $PREV_IMAGE"
  APP_IMAGE="$PREV_IMAGE" docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d app proxy
  exit 1
fi

echo "No previous image found for rollback."
exit 1
