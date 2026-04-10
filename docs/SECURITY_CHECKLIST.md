# SIGINT DataCenter Pro — Checklist de Seguridad y Hardening

## Estado: usar antes de pasar a producción

---

## 1. Infraestructura y red

- [ ] **Firewall**: solo puertos 80, 443 y SSH abiertos al exterior. Puerto 8080 solo desde IP del administrador.
- [ ] **SSH**: deshabilitar login con contraseña (`PasswordAuthentication no` en `/etc/ssh/sshd_config`). Usar solo claves SSH.
- [ ] **Fail2ban**: activo y bloqueando intentos fallidos en SSH y Nginx.
- [ ] **Swap**: configurado (4GB mínimo) para evitar OOM killer en picos de carga.
- [ ] **Actualizaciones**: `apt-get upgrade` periódico. Configurar `unattended-upgrades` para parches de seguridad automáticos.
- [ ] **Dockersocket**: no montar `/var/run/docker.sock` en contenedores de producción excepto donde sea estrictamente necesario (cadvisor).
- [ ] **Usuario no-root**: todos los contenedores corren con usuarios sin privilegios (sigint, pipeline, mluser).

---

## 2. Credenciales y secretos

- [ ] **SECRET_KEY**: mínimo 64 caracteres aleatorios. Generar con `openssl rand -hex 32`.
- [ ] **JWT_SECRET**: diferente de SECRET_KEY. Otro `openssl rand -hex 32`.
- [ ] **POSTGRES_PASSWORD**: mínimo 24 caracteres, alfanumérico + símbolos.
- [ ] **NEO4J_PASSWORD**: ídem.
- [ ] **REDIS_PASSWORD**: ídem.
- [ ] **GRAFANA_PASSWORD**: cambiar el default `changeme_grafana`.
- [ ] **No hay contraseñas en el repositorio Git**: verificar con `git log --all -p | grep -i password`.
- [ ] **Rotar contraseñas** cada 90 días como mínimo.
- [ ] **Campos cifrados en BD**: verificar que `totp_secret` y `config` de fuentes OSINT están cifrados con AES-256-GCM.

---

## 3. TLS / SSL

- [ ] **Certificado válido**: emitido por Let's Encrypt, sin warnings en navegador.
- [ ] **Redirección HTTP→HTTPS**: todas las peticiones HTTP redirigen a HTTPS.
- [ ] **HSTS activo**: `Strict-Transport-Security: max-age=31536000; includeSubDomains`.
- [ ] **TLS 1.2+ únicamente**: TLS 1.0 y 1.1 deshabilitados.
- [ ] **Renovación automática**: certbot corriendo y renovando antes de expirar (verificar con `docker compose logs certbot`).
- [ ] **Cipher suites modernas**: verificar con [SSL Labs](https://www.ssllabs.com/ssltest/) — resultado A o A+.

---

## 4. Autenticación y autorización

- [ ] **2FA activado** para todos los usuarios con nivel 3+.
- [ ] **Política de contraseñas**: mínimo 12 caracteres, mayúsculas, minúsculas, números y símbolo.
- [ ] **Bloqueo por intentos fallidos**: 10 intentos fallidos bloquean la cuenta.
- [ ] **Rate limiting en login**: máximo 5 intentos por minuto por IP (configurado en Nginx).
- [ ] **Tokens JWT con expiración corta**: 8 horas para access token, 7 días para refresh.
- [ ] **RLS activo en PostgreSQL**: verificar que `app.current_user_id` se inyecta en todas las queries.
- [ ] **Revisar permisos de roles**: verificar que los 6 roles tienen los permisos correctos y que ningún usuario tiene nivel de acceso mayor al necesario (principio de mínimo privilegio).

---

## 5. Base de datos

- [ ] **PostgreSQL no expuesto**: puerto 5432 solo accesible desde dentro de la red Docker, no desde el exterior.
- [ ] **Neo4j no expuesto**: puertos 7474 y 7687 solo internos.
- [ ] **Redis no expuesto**: puerto 6379 solo interno.
- [ ] **Backups verificados**: ejecutar `gunzip -t backups/YYYYMMDD/postgres_*.gz` para confirmar integridad.
- [ ] **Backup automático activo**: cron ejecutando `backup.sh` a las 2:00 AM.
- [ ] **Retención correcta**: 7 diarios, 4 semanales, 3 mensuales.
- [ ] **Backup offsite**: copiar backups a almacenamiento externo (S3, SFTP remoto, etc.).

---

## 6. Monitoreo y alertas

- [ ] **Grafana activo**: accesible en puerto 8080 solo desde IP de administración.
- [ ] **Alertas configuradas**: revisar `alert_rules.yml` y asegurarse de que las alertas llegan (email/Slack via Alertmanager).
- [ ] **Logs centralizados**: Loki recogiendo logs de todos los contenedores.
- [ ] **Retención de logs**: 30 días en Loki, 14 días en logrotate.
- [ ] **Auditoría activa**: todas las acciones de usuarios se registran en `audit.log_accesos`.

---

## 7. Aplicación

- [ ] **Headers de seguridad**: verificar con [Security Headers](https://securityheaders.com/) — resultado A.
- [ ] **CSP configurado**: Content-Security-Policy sin `unsafe-eval`, con `nonce` si es posible.
- [ ] **Adminer bloqueado**: acceso a `/adminer` bloqueado en Nginx (ya configurado).
- [ ] **Redis Commander bloqueado**: ídem.
- [ ] **Documentación API**: `/docs` y `/redoc` deshabilitados en producción (o protegidos con autenticación básica).
- [ ] **CORS estricto**: solo se permite el dominio propio, no `*`.
- [ ] **Archivos subidos**: validación de tipo MIME, límite de tamaño (20MB), almacenados fuera del webroot.
- [ ] **SQL injection**: todos los queries usan parámetros nombrados de SQLAlchemy, nunca concatenación de strings.

---

## 8. Gestión operativa

- [ ] **Runbook de incidentes**: procedimiento documentado para caídas, brechas de seguridad y pérdida de datos.
- [ ] **Contacto de emergencia**: quién avisar si hay incidente fuera del horario laboral.
- [ ] **Procedimiento de restauración**: probado al menos una vez. Documentar tiempo de recuperación (RTO).
- [ ] **Plan de continuidad**: qué ocurre si el servidor principal cae. ¿Hay servidor de backup?
- [ ] **Accesos compartidos**: no usar cuentas compartidas. Cada operador tiene su propia cuenta en el sistema.
- [ ] **Offboarding**: procedimiento para revocar accesos cuando un operador deja el equipo.

---

## 9. Pentest básico (verificación manual)

Ejecutar antes de poner en producción:

```bash
# Verificar headers de seguridad
curl -I https://tu-dominio.com

# Verificar que el redirect HTTP→HTTPS funciona
curl -I http://tu-dominio.com

# Verificar rate limiting en login (debe devolver 429 tras 5 intentos)
for i in {1..10}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST https://tu-dominio.com/api/v1/auth/login \
    -H "Content-Type: application/json" \
    -d '{"username":"test","password":"wrong"}'
done

# Verificar que Neo4j no es accesible desde exterior
curl -I http://tu-dominio.com:7474  # debe fallar/timeout

# Verificar que PostgreSQL no es accesible desde exterior
nc -zv tu-dominio.com 5432          # debe fallar

# Verificar que /adminer está bloqueado
curl -I https://tu-dominio.com/adminer  # debe devolver 403
```

---

## 10. Comandos operativos útiles

```bash
# Ver estado de todos los servicios
docker compose ps

# Ver logs en tiempo real
docker compose logs -f backend
docker compose logs -f --tail=100 pipeline

# Reiniciar un servicio sin parar los demás
docker compose restart backend

# Ejecutar backup manual
./scripts/backup.sh

# Aplicar actualizaciones (zero-downtime con rolling restart)
docker compose pull backend frontend
docker compose up -d --no-deps backend
docker compose up -d --no-deps frontend

# Escalar backend horizontalmente (si hay balanceador)
docker compose up -d --scale backend=3

# Ejecutar migración SQL
docker compose exec postgres psql -U sigint_admin -d sigint < database/migrations/XXX.sql

# Verificar integridad del último backup
ls -lt backups/ | head -5
gunzip -t backups/$(ls backups/ | sort | tail -1)/postgres_*.gz

# Ver métricas en tiempo real
curl http://localhost:8000/metrics
```
