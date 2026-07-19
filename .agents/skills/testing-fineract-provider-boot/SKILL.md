---
name: testing-fineract-provider-boot
description: Boot the Fineract provider locally and verify it serves its REST API end-to-end. Use when testing that the backend actually starts and responds (e.g. after Java/Spring/Gradle upgrades or DB/config changes), not just that it compiles.
---

# Testing the Fineract provider boots & serves the API

Fineract is a backend REST API (no in-repo GUI — the `community-app` frontend is a separate Docker image).
So "end-to-end" testing = **boot the provider against a real DB and hit the API with curl**. There is no UI
to record; capture curl output as evidence instead.

**Critical lesson:** `./gradlew clean build -x test` passing is NOT proof the app runs. Always actually boot
it. Several failure modes only appear at runtime.

## 1. Start a database (Docker)
The provider defaults to MySQL/MariaDB on `localhost:3306`, user `root`, password `mysql`
(see `fineract-provider/src/main/resources/META-INF/spring/jdbc.properties` and
`TenantDatabaseUpgradeService` env-var defaults). The compose file uses a long password; for local testing
just make everything `mysql`:

```bash
docker run -d --name fineract-mysql -e MYSQL_ROOT_PASSWORD=mysql -e MYSQL_ROOT_HOST=% -p 3306:3306 \
  -v "$PWD/fineract-db/docker":/docker-entrypoint-initdb.d:ro mysql:5.7
```
The init script only creates empty `fineract_tenants` + `fineract_default`; **Flyway migrates them
automatically at boot** (first boot is slower). `MYSQL_ROOT_HOST=%` is needed so the app (connecting from
the docker gateway IP) can auth as root with the password.

## 2. Boot the provider (pick the right JDK)
```bash
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64   # match the repo's current baseline
export FINERACT_DEFAULT_TENANTDB_HOSTNAME=localhost FINERACT_DEFAULT_TENANTDB_PORT=3306 \
       FINERACT_DEFAULT_TENANTDB_UID=root FINERACT_DEFAULT_TENANTDB_PWD=mysql \
       fineract_tenants_uid=root fineract_tenants_pwd=mysql
nohup ./gradlew :fineract-provider:bootRun --console=plain > /tmp/bootrun.log 2>&1 &
```
Wait for `Started ServerApplication` + `Tomcat started on port(s): ... 8443 (https)` in the log. HTTPS is on
`:8443`, context path `/fineract-provider`, self-signed keystore (so use `curl -k`).
`org.apache.fineract.ServerWithMariaDB4jApplication` is an alternative that boots an embedded MariaDB (no
Docker) if you can't run a DB container.

## 3. Verify the API
```bash
curl -sk https://localhost:8443/fineract-provider/actuator/health                       # {"status":"UP"}
curl -sk -X POST "https://localhost:8443/fineract-provider/api/v1/authentication?tenantIdentifier=default" \
  -H "Content-Type: application/json" -d '{"username":"mifos","password":"password"}'    # authenticated:true
# Basic auth for reads (bWlmb3M6cGFzc3dvcmQ= == mifos:password):
curl -sk "https://localhost:8443/fineract-provider/api/v1/users?tenantIdentifier=default" \
  -H "Authorization: Basic bWlmb3M6cGFzc3dvcmQ="
```
Default super user is `mifos`/`password`, tenant `default`. A good discriminating read is `/users` (it
serializes `java.time` fields — see below). `/offices` returns `Head Office`.

## Known runtime failure modes on newer JDK / Spring Boot (and workarounds)
These may or may not still be present depending on the branch; if boot fails, check for:
- **`Alias 'springSecurityFilterChain' would override bean definition`** — Spring Security 5.7 double-registers
  the filter chain when both `@EnableWebSecurity` (in `AbstractApplicationConfiguration`) and the XML `<http>`
  namespace are present. Workaround: drop `@EnableWebSecurity` (XML already enables web security).
- **`APPLICATION FAILED TO START ... circular references`** — Spring Boot 2.6+ bans bean cycles by default.
  Workaround: `spring.main.allow-circular-references=true`.
- **`InaccessibleObjectException: ... java.time... module java.base does not "opens java.time"`** on API calls
  (e.g. `GET /users`, HTTP 500) — the forked `bootRun`/`test` JVM needs runtime `--add-opens` (Gson reflection).
  Note `org.gradle.jvmargs` in `gradle.properties` only covers the *build daemon*, not forked run/test JVMs.

## Gotcha: application.properties is generated
`fineract-provider/src/main/resources/application.properties` is **git-ignored and overwritten at build
config time** from `fineract-provider/properties/<security>/application.properties` (default `basicauth`; see
the copy block in `fineract-provider/build.gradle`). Edit the template(s) under `properties/`, not the copy.

## Devin Secrets Needed
None. Uses a local throwaway MySQL container and the built-in default `mifos`/`password` credentials.
