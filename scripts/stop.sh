#!/bin/bash
# stop.sh — Para el sistema limpiamente
echo "Parando SIGINT DataCenter Pro..."
docker compose stop
echo "Sistema parado. Los datos están guardados en los volúmenes Docker."
echo "Para arrancar de nuevo: ./scripts/start.sh"
