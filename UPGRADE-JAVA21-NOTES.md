# Java 21 / Spring Boot 3 Migration Notes

Branch: `demo/java21-nminus1` (off `demo/java11-baseline`). **This branch must NOT be merged into
`demo/java11-baseline`.** It is a supervised, reviewer-facing migration record.

Goal: migrate Apache Fineract from **Java 11 / Spring Boot 2.3.5 / `javax.*`** to
**Java 21 / Spring Boot 3.2.x / `jakarta.*`**.

This document is a running, plain-English log of every decision, version chosen, blocker hit, and the
reasoning behind it. It is organised by the numbered phases from the migration brief. Each phase is
committed separately so the diff can be reviewed per-phase.

---

## Environment (as found on the build machine)

- JDKs available: 11, 17, 21 (`/usr/lib/jvm/java-21-openjdk-amd64`).
- Baseline branch state: Gradle wrapper **6.9**, `JavaVersion.VERSION_11` everywhere,
  `fineract-client` pinned to Java 8 (FINERACT-1214), Spring Boot **2.3.5.RELEASE**,
  Spring Framework **5.3.7**.
- ~502 Java files reference `javax.*`.

### javax.* usage inventory (drives Phase 3 scope)

Counting import statements across `*.java`:

| package | occurrences | migrate to jakarta? |
|---|---|---|
| `javax.persistence` (+`.spi`) | ~1383 | **YES** -> `jakarta.persistence` |
| `javax.ws.rs` (+`.core`,`.ext`) | ~1550 | **YES** -> `jakarta.ws.rs` |
| `javax.servlet` (+`.http`) | ~25 | **YES** -> `jakarta.servlet` |
| `javax.jms` | 18 | **YES** -> `jakarta.jms` |
| `javax.annotation.PostConstruct` / `PreDestroy` | 11 | **YES** -> `jakarta.annotation.*` |
| `javax.mail` (+`.internet`) | ~6 | **YES** -> `jakarta.mail` |
| `javax.xml.bind.annotation` (JAXB) | 2 | **YES** -> `jakarta.xml.bind` |
| `javax.annotation.Nullable` | 1 | **NO** — JSR-305 (findbugs), stays `javax.annotation` |
| `javax.cache` | present | **NO** — JCache (JSR-107) keeps the `javax.cache` namespace even under Jakarta EE 9+ |
| `javax.sql`, `javax.net.ssl`, `javax.script`, `javax.imageio`, `javax.xml.parsers`, `javax.inject`(none found) | Java SE | **NO** — stay `javax.*` |

`javax.validation` / `javax.transaction` imports: none found in source (only referenced transitively).

### Chosen target versions (summary)

| component | from | to | why |
|---|---|---|---|
| Gradle wrapper | 6.9 | 8.7 | Gradle 6.9 cannot run on JDK 21; 8.x is the first line with full JDK 21 support |
| Java source/target | 11 | 21 | migration target |
| `fineract-client` Java | 8 | 21 | explicit reviewer decision to override FINERACT-1214 pin |
| Spring Boot plugin + BOM | 2.3.5.RELEASE | 3.2.5 | Spring Boot 3.x = Jakarta baseline; 3.2.x per brief |
| spring-framework-bom | 5.3.7 | 6.1.6 | matches Spring Boot 3.2.5 |
| io.spring.dependency-management | 1.0.11.RELEASE | 1.1.4 | Gradle 8 compatible |
| com.diffplug.spotless | 5.12.5 | 6.25.0 | Gradle 8 / JDK 21 compatible |
| org.nosphere.apache.rat | 0.7.0 | 0.8.1 | Gradle 8 compatible |
| spotbugs-gradle-plugin | 4.7.1 | 6.0.18 | Gradle 8 / JDK 21 |
| net.ltgt.errorprone | 2.0.1 | 3.1.0 | Gradle 8; needs error_prone_core >= 2.24 for JDK 21 |
| error_prone_core | 2.6.0 | 2.28.0 | JDK 21 support |
| io.swagger.core.v3 swagger-gradle-plugin | 2.1.9 | 2.2.20 | Gradle 8 / jakarta swagger |
| openjpa (lib) | 3.2.0 | see **Phase 4** | jakarta.persistence support = OpenJPA 4.x |
| openjpa-gradle-plugin (enhancer) | 3.1.0 | see **Phase 4** | **blocker — no jakarta-capable release** |
| gradle-cargo-plugin | 2.8.0 | 2.8.0 (kept) | 2.8.0 is the latest published; see Phase 5/8 risk note |
| Jersey | com.sun.jersey 1.19.4 | org.glassfish.jersey 3.1.5 | Sun Jersey 1.x is abandoned/non-jakarta |
| spring-security-oauth2 | 2.5.1.RELEASE | removed | removed in Spring Security 6; see **Phase 6** |
| repositories | jcenter() | mavenCentral() | JCenter is shut down |

Detailed reasoning and per-phase outcomes follow below.

---

## Phase 1 — Build toolchain & Java level

**Done:**

- `gradle/wrapper/gradle-wrapper.properties`: `gradle-6.9-bin.zip` -> `gradle-8.7-bin.zip`. Gradle 6.9
  cannot run on JDK 21 (it fails to parse the class-file/JVM version). 8.7 is a stable 8.x with full
  JDK 21 support.
- Root `build.gradle`: `sourceCompatibility` / `targetCompatibility` `VERSION_11` -> `VERSION_21`
  (applies to all `fineractJavaProjects`).
- `fineract-client/build.gradle`: raised from `VERSION_1_8` to `VERSION_21`. This deliberately
  overrides the FINERACT-1214 pin (that pin existed so the generated client SDK stayed consumable by
  Java 8 callers; the reviewer's "full migration" decision supersedes it). Documented at the edit site.
- `jcenter()` -> `mavenCentral()` in both the `buildscript` repositories and the `allprojects`
  repositories (JCenter is shut down / read-only-sunset).
- Plugin/toolchain version bumps for Gradle 8 + JDK 21 compatibility:
  - `io.spring.dependency-management` 1.0.11.RELEASE -> 1.1.4
  - `com.diffplug.spotless` 5.12.5 -> 6.25.0
  - `org.nosphere.apache.rat` 0.7.0 -> 0.8.1
  - `com.github.hierynomus.license` 0.15.0 -> 0.16.1
  - `org.openapi.generator` 4.3.1 -> 6.6.0 (4.x is not Gradle-8 compatible; 6.6.0 generates
    jakarta-based clients, relevant to `fineract-client`)
  - spotbugs gradle plugin 4.7.1 -> `com.github.spotbugs.snom:spotbugs-gradle-plugin:6.0.18`
    (the old `gradle.plugin.…` coordinate is dropped)
  - `net.ltgt.errorprone` 2.0.1 -> 3.1.0, and `error_prone_core` 2.6.0 -> 2.28.0 (JDK 21 support)
  - `io.swagger.core.v3.swagger-gradle-plugin` 2.1.9 -> 2.2.20
  - `gradle-cargo-plugin` kept at 2.8.0 (latest published on the plugin portal)
  - `gradle-modernizer-plugin` `gradle.plugin.com.github.andygoossens:…:1.3.0` ->
    `com.github.andygoossens:gradle-modernizer-plugin:1.9.2` (Gradle 8 / Java 21 target support)

**Gradle 8 removed-API fixes (would otherwise fail configuration of every module, including the
lint/test target `fineract-client`):**

- Removed `apply plugin: 'maven'` (the legacy `maven` plugin was removed in Gradle 7; `maven-publish`
  remains).
- `jacoco { reportsDir = … }` -> `reportsDirectory = …` (the `reportsDir` property was removed).
- `jacocoTestReport` reports: `html.enabled` / `xml.enabled` -> `.required`, and
  `html.destination` -> `html.outputLocation`.

**Not yet touched / known follow-ups (surfaced by build in Phase 8):** other lazy-property /
`buildDir` deprecations, `sourceSets…outputDir`, and any plugin that still rejects JDK 21 at runtime.

**Iterating `./gradlew help` to a clean configuration surfaced a chain of Gradle-8 removals and
dead-jcenter transitive deps (all fixed in the Phase 1 commits):**

- `com.radcortez.gradle:openjpa-gradle-plugin` 3.1.0 was jcenter-only -> 3.2.0 (latest published).
- `gradle-git-properties` 2.2.4 pulled `org.ajoberstar.grgit:grgit-core:4.1.0` (jcenter) -> bumped to
  2.4.1 (grgit 5.x on Maven Central); its `gitPropertiesResourceDir` is now a `Directory` property,
  so the value is wrapped in `file(...)`.
- The `org.asciidoctor.jvm.gems` / `.epub` / kindlegen plugins (declared `apply false`, never actually
  applied) transitively dragged in the jcenter-only `com.burgstaller:okhttp-digest:1.10` via
  `jruby-gradle`/`http-builder-ng`. Removed the three unused plugins; bumped the *used* asciidoctor
  plugins (`convert`/`pdf`/`revealjs`) 3.3.2 -> 4.0.4 (4.0.2 is not published for revealjs).
- spotbugs plugin 6.x: `reportLevel = 'high'` -> `reportLevel = Confidence.valueOf('HIGH')`; report
  `enabled` -> `required`; spotbugs core 4.2.2 -> 4.8.3.
- `fineract-doc`: `archiveName` -> `archiveFileName`.

---

## Phase 2 — Spring Boot 3 / Framework 6

**Done:**

- Root `build.gradle` BOM imports:
  - `spring-framework-bom` 5.3.7 -> **6.1.6**
  - `spring-boot-dependencies` 2.3.5.RELEASE -> **3.2.5**
  - `junit-bom` 5.7.2 -> 5.10.2 (5.7.2 predates the JUnit that Boot 3.2 expects)
- `spring-boot-starter-mail` pin 2.3.4.RELEASE -> 3.2.5.
- The `org.springframework.boot` Gradle plugin was bumped to 3.2.5 in the Phase 1 `plugins {}` block
  (it lives alongside the other plugin coordinates); the BOM/version wiring is completed here.
- Spring Boot 3 Gradle plugin API changes in `fineract-provider/build.gradle`:
  - `springBoot { mainClassName = … }` -> `mainClass = …`
  - Gradle 8 archive-API: `Tar.extension` -> `archiveExtension`; distribution `baseName` ->
    `distributionBaseName`; `tasks.*.enabled false` -> `enabled = false`.

**Result:** `./gradlew help` configures cleanly on Gradle 8.7 + JDK 21 with the Boot 3.2.5 / Framework
6.1.6 BOMs. As the brief predicted, this does **not compile** yet — Spring Boot 3 pulls
`jakarta.*` APIs while the source still imports `javax.*`. That is Phase 3.

---

## Phase 3 — `javax.*` -> `jakarta.*` namespace migration

**Scripted find/replace** across all non-`build/` `*.java` files (a single `perl -i` pass, word-boundary
anchored so we don't hit unrelated packages), doing exactly these prefix rewrites:

```
javax.persistence            -> jakarta.persistence   (covers .spi too)
javax.ws.rs                  -> jakarta.ws.rs         (covers .core / .ext)
javax.servlet                -> jakarta.servlet       (covers .http)
javax.jms                    -> jakarta.jms
javax.mail                   -> jakarta.mail          (covers .internet)
javax.xml.bind               -> jakarta.xml.bind      (JAXB only; NOT javax.xml.parsers/transform)
javax.validation             -> jakarta.validation
javax.annotation.PostConstruct -> jakarta.annotation.PostConstruct
javax.annotation.PreDestroy    -> jakarta.annotation.PreDestroy
```

**Deliberately NOT rewritten** (verified by re-grepping afterwards — these are all that remain and are
correct):

- `javax.annotation.Nullable` — JSR-305 (findbugs/spotbugs), never moved to Jakarta.
- `javax.cache` — JCache (JSR-107) keeps the `javax.cache` namespace under Jakarta EE 9+.
- Java SE packages: `javax.sql`, `javax.net.ssl`, `javax.script`, `javax.imageio`, `javax.xml.parsers`.
- `javax.inject` / `javax.annotation.Resource` / `javax.annotation.Priority`: the only remaining hits
  are **comments and one classpath-string** inside the test
  `ClasspathHellDuplicatesChecker` (a duplicate-class detector); there are no real `javax.inject`
  imports in production code, so nothing to migrate there.

**XML descriptors:**

- `META-INF/persistence.xml`: namespace `http://java.sun.com/xml/ns/persistence` (v2.0) ->
  `https://jakarta.ee/xml/ns/persistence` (v3.0).
- `WEB-INF/web.xml`: `http://java.sun.com/xml/ns/javaee` (web-app 3.0) ->
  `https://jakarta.ee/xml/ns/jakartaee` (web-app 6.0). (This descriptor is effectively unused under
  Spring Boot but was updated for correctness.)

**Dependency-coordinate updates** (root `dependencyManagement`) needed because the *jakarta namespace*
only appears at higher API versions:

- `jakarta.jms:jakarta.jms-api` 2.0.3 -> **3.1.0** (2.0.x still ships the `javax.jms` package).
- `jakarta.xml.bind:jakarta.xml.bind-api` 2.3.3 -> **4.0.2** (2.3.x still ships `javax.xml.bind`).
- `org.glassfish.jaxb:jaxb-runtime` 2.3.4 -> **4.0.5** (jakarta JAXB runtime).
- `jakarta.validation:jakarta.validation-api` 3.0.0 -> **3.0.2**.

**Known follow-ups deferred to later phases / Phase 8 build:**

- The JAX-RS API is now `jakarta.ws.rs`, but the *implementation* on the classpath is still Sun Jersey
  1.19.4 (`javax.ws.rs`). Compilation will not succeed until **Phase 5** swaps Jersey.
- `jakarta.mail` imports now require a `jakarta.mail-api` provider; Apache Commons Email 1.5 (still
  `javax.mail`) is a likely conflict — flagged for Phase 8.
- `com.sun.activation:jakarta.activation:1.2.2` (javax.activation) vs. jakarta activation 2.1 — flagged
  for Phase 8.

---

## Phase 4 — Persistence provider (OpenJPA) — HIGH RISK

**Decision: OpenJPA 4.0.0 is a viable `jakarta.persistence` provider — upgraded (not blocked).**

Investigation (evidence gathered from Maven Central POMs):

- OpenJPA **4.0.0** (and 4.0.1/4.1.x) declare `Specification-Title: Jakarta Persistence` and depend on
  the true jakarta-namespaced APIs:
  - `jakarta.persistence:jakarta.persistence-api:3.0.0` (the `jakarta.persistence.*` package; 2.2.x is
    still `javax.persistence`)
  - `jakarta.jms:jakarta.jms-api:3.1.0`, `jakarta.transaction:jakarta.transaction-api:2.0.1`,
    `jakarta.annotation:jakarta.annotation-api:2.1.1`
- The 3.x line (incl. 3.2.2) is `javax.persistence`; it also uses the legacy **serp** bytecode library,
  which does not handle Java 9+ class files and fails to enhance on JDK 17/21. OpenJPA **4.0.0** replaced
  serp with ASM, so its enhancer runs on JDK 21. This is the decisive reason to go to 4.0.0.

Changes made (all three pinned locations):

- `buildscript` classpath: `org.apache.openjpa:openjpa` 3.2.0 -> **4.0.0**.
- `dependencyManagement`: `org.apache.openjpa:openjpa` 3.2.0 -> **4.0.0** (this is what
  `fineract-provider/dependencies.gradle` resolves via `implementation('org.apache.openjpa:openjpa')`).
- `META-INF/persistence.xml` already updated to Jakarta Persistence 3.0 in Phase 3; the provider class
  `org.apache.openjpa.persistence.PersistenceProviderImpl` keeps the same FQN in 4.0.0.

**The enhancer Gradle plugin (`com.radcortez.gradle:openjpa-gradle-plugin`) — residual risk:**

- There is **no jakarta-specific / 4.x release** of this plugin; 3.2.0 is the latest published (3.1.0,
  the version the baseline pinned, was jcenter-only and is now unresolvable).
- Its Gradle module metadata shows only a *soft* `requires org.apache.openjpa:openjpa:3.2.2`. Because we
  put `openjpa:4.0.0` explicitly on the same `buildscript` classpath, Gradle conflict-resolution selects
  4.0.0, so the plugin drives the **4.0.0** `PCEnhancer`. This is the closest thing to "upgrading the
  enhancer plugin" that exists.
- **Residual risk (verify in Phase 8):** the 3.2.0 plugin was compiled against the 3.2.2 enhancer API.
  If `PCEnhancer`'s invoked API changed in 4.0.0 the `openjpaEnhance` task could fail at runtime. If that
  happens, the documented fallback is to drop the plugin and run the enhancer directly via a `JavaExec`
  task invoking `org.apache.openjpa.enhance.PCEnhancer` against the 4.0.0 classpath (no third-party
  plugin needed). Left as a follow-up rather than pre-emptively rewritten.

---

## Phase 5 — JAX-RS / Jersey (Sun Jersey 1.19.4 -> Jersey 3.1.5)

Sun Jersey 1.19.4 (`com.sun.jersey`) is abandoned and `javax.ws.rs`-only, so it cannot satisfy the
`jakarta.ws.rs` imports produced in Phase 3. Migrated to **Jersey 3.1.5** (`org.glassfish.jersey`,
jakarta-based). `project.ext.jerseyVersion` 1.19.4 -> **3.1.5**.

**Dependency coordinates** (`fineract-provider/dependencies.gradle`):

| old (`com.sun.jersey*`) | new (`org.glassfish.jersey*` 3.1.5) |
|---|---|
| `jersey-core`, `jersey-server` | `core:jersey-server` |
| `jersey-servlet` | `containers:jersey-container-servlet` + `containers:jersey-container-servlet-core` |
| `contribs:jersey-multipart` | `media:jersey-media-multipart` |
| `jersey-json` | `media:jersey-media-json-jackson` |
| `contribs:jersey-spring` | `ext:jersey-spring6` (Spring 6 integration) |
| (implicit) | `inject:jersey-hk2` (DI runtime) |

**API differences encountered / code changes:**

- **Servlet registration** (`WebXmlConfiguration`, `WebXmlOauthConfiguration`): the old
  `com.sun.jersey…SpringServlet` + string init-params (`POJOMappingFeature`, `DisableWADL`,
  `ContainerResponseFilters`) is gone. Replaced with a standard Jersey
  `org.glassfish.jersey.servlet.ServletContainer` driven by a new `ResourceConfig`
  (`FineractJerseyConfig`) still mapped at `/api/v1/*`. Spring-bean bridging that Sun Jersey's
  `SpringServlet` did is now provided by `jersey-spring6`'s auto-registered `SpringComponentProvider`,
  so the 139 `@Component`/`@Path` resources keep their injected dependencies.
- **`FineractJerseyConfig`** (new) scans package `org.apache.fineract` for `@Path`/`@Provider`, registers
  `MultiPartFeature` and the CORS filter, and disables WADL via `ServerProperties.WADL_FEATURE_DISABLE`.
- **`ResponseCorsFilter`**: reimplemented from the proprietary
  `com.sun.jersey.spi.container.ContainerResponseFilter` (`filter(ContainerRequest, ContainerResponse)`
  returning a response) to the standard JAX-RS
  `jakarta.ws.rs.container.ContainerResponseFilter` (`filter(requestCtx, responseCtx)` mutating
  `responseCtx.getHeaders()`), annotated `@Provider`.
- **Multipart** (26×`FormDataContentDisposition`, 18×`FormDataParam`, 4×`FormDataBodyPart`): package
  `com.sun.jersey.core.header` / `com.sun.jersey.multipart` -> `org.glassfish.jersey.media.multipart`
  (scripted).
- **`Base64`** (`AuthenticationApiResource`): `com.sun.jersey.core.util.Base64.encode(String)` -> JDK
  `java.util.Base64.getEncoder().encode(bytes)`.
- **`MultivaluedMapImpl`** (`ReportMailingJobWritePlatformServiceImpl`):
  `com.sun.jersey.core.util.MultivaluedMapImpl` -> standard `jakarta.ws.rs.core.MultivaluedHashMap`.

No remaining `com.sun.jersey` references anywhere in `fineract-provider/src`.

---

## Phase 6 — OAuth2 / Spring Security 6

**What was removed / why.** `spring-security-oauth:spring-security-oauth2:2.5.1.RELEASE` (and the Apache
`oltu` client libraries it paired with) reached end-of-life and is **not compatible with Spring Security 6**;
the entire `org.springframework.security.oauth2.provider.*` API, the `<oauth:authorization-server>` /
`<oauth:resource-server>` XML namespace, `DefaultTokenServices`, `JdbcTokenStore`,
`JdbcClientDetailsService`, `ClientCredentialsTokenEndpointFilter`, `ScopeVoter` and the
`AccessDecisionManager`/voter authorization model are all gone. There is **no mechanical migration**.

**Dependency changes:**
- Removed `oltuVersion` and the three `org.apache.oltu.oauth2.*` dependencies (`build.gradle`).
- Removed `spring-security-oauth2:2.5.1.RELEASE` from `dependencyManagement` (`build.gradle`).
- Removed `org.springframework.security.oauth:spring-security-oauth2` from provider deps and added
  `org.springframework.boot:spring-boot-starter-oauth2-resource-server` (`dependencies.gradle`) for the
  eventual resource-server rebuild.

**Security config rebuild (basicauth profile — DONE, review-required).** The legacy `securityContext.xml`
used the pre-6 XML DSL (`<http use-expressions="true">`, `access-decision-manager-ref`, SpEL
`access="…"`, `<custom-filter>` positions, `<authentication-manager>`), none of which is valid under
Spring Security 6. It was **deleted** and its `<import>` removed from `appContext.xml`. The default
`basicauth` profile is reimplemented in Java as
`org.apache.fineract.infrastructure.core.boot.SecurityConfiguration` — a `@Profile("basicauth")`
`SecurityFilterChain` that:
- is `stateless`, CSRF-disabled, `requiresChannel(...).requiresSecure()` (HTTPS), matches `/api/**`;
- `permitAll` for `echo`, `POST authentication`, `POST self/authentication`, `POST self/registration`,
  `POST self/registration/user`; `fullyAuthenticated` for the `twofactor` endpoints; and
  `isFullyAuthenticated() and hasAuthority('TWOFACTOR_AUTHENTICATED')` (via
  `WebExpressionAuthorizationManager`) for everything else;
- re-registers the existing custom filters `basicAuthenticationProcessingFilter`
  (`TenantAwareBasicAuthenticationFilter`) after `SecurityContextHolderFilter` and `twoFactorAuthFilter`
  after `BasicAuthenticationFilter`;
- provides the `passwordEncoder` (delegating), `basicAuthenticationEntryPoint`,
  `customAuthenticationProvider` (`DaoAuthenticationProvider`) and non-erasing
  `AuthenticationManager` beans that the XML used to define.
- Uses explicit `AntPathRequestMatcher.antMatcher(...)` for every rule so the matchers are unambiguous
  under Jersey (Spring Security 6 otherwise defaults to MVC matchers).

Also decoupled `TwoFactorAuthenticationFilter` from the removed `OAuth2Authentication` (it now returns a
plain `UsernamePasswordAuthenticationToken` with the augmented authorities).

**BLOCKER — the `oauth` authorization-server profile is NOT migrated.** Fineract's `oauth` profile ran a
full self-hosted OAuth2 **authorization server** (password + refresh-token grants, JDBC client/token
stores, a `/api/oauth/token` endpoint) on the dead `spring-security-oauth2` library. Rebuilding it is a
design decision for the human reviewer, not a mechanical port. The OAuth2-only API classes that hard-depended
on the removed API were removed to let the tree compile: `UserDetailsApiResource`(+Swagger),
`SelfUserDetailsApiResource`(+Swagger) and `AuthenticatedOauthUserData`. `WebXmlOauthConfiguration` (the
`/api/oauth/token` dispatcher, `@Profile("oauth")`) is left in place but will not function until the server
is rebuilt.

Options for the reviewer:
1. **Spring Authorization Server** (`org.springframework.security:spring-security-oauth2-authorization-server`)
   — the official successor; re-model clients as `RegisteredClient`, replace `JdbcClientDetailsService`/
   `JdbcTokenStore` with its JDBC variants, and expose the token endpoint. Largest effort, closest to the
   old feature set (custom grants like the old `password` grant are discouraged/removed in OAuth 2.1).
2. **Resource-server only** (`spring-boot-starter-oauth2-resource-server`, already added) — if tokens are
   issued by an external IdP (Keycloak/Auth0/…), Fineract only validates JWTs. Much smaller, but changes the
   deployment model.
3. **Drop OAuth2**, keep only `basicauth` — simplest; acceptable if the OAuth2 profile is unused.

Until one is chosen, running with `-Dspring.profiles.active=oauth` is expected to fail; `basicauth`
(the default) is the supported path in this branch.

---

## Phase 7 — Docker & CI

**`Dockerfile`:**
- Builder `FROM openjdk:11` -> `FROM eclipse-temurin:21-jdk` (the `openjdk:*` images are deprecated;
  Temurin is the maintained JDK 21 image and matches the toolchain used elsewhere).
- Runtime `FROM gcr.io/distroless/java:11` -> `FROM gcr.io/distroless/java21-debian12` (distroless no
  longer publishes a `java:11` tag; the versioned `java21-debian12` is the current form).
- ENTRYPOINT and jar paths unchanged: the bootJar is still
  `fineract-provider/build/libs/fineract-provider.jar` and is launched with
  `-Dloader.path=/app/libs/`, which remains valid for a Boot 3 fat jar.

**`.travis.yml`:**
- `dist: bionic` -> `dist: jammy` (Ubuntu 22.04) — bionic (18.04) has no `openjdk-21-jdk-headless` apt
  package.
- `apt-get install openjdk-11-jdk-headless` -> `openjdk-21-jdk-headless`; `JAVA_HOME` set to
  `/usr/lib/jvm/java-21-openjdk-amd64/`.
- CI is not exercised here (Travis is external); these are the mechanical version bumps.

---

## Phase 8 — Build & test

This phase is the iterative "make it actually build" work. It is split into two commits:
one mechanical (spotless import re-ordering that the Phase 3 namespace migration made necessary)
and one functional (dependency / task-graph / source fixes described below).

### 8.0 Result summary (read this first)

- **`fineract-provider` (the core Spring Boot server) fully builds on Java 21 / Spring Boot 3.2.5 /
  Jakarta**, including the OpenJPA 4 bytecode enhancer and the Swagger/OpenAPI spec generation, and
  **`./gradlew :fineract-provider:bootJar` produces a runnable fat jar**
  (`fineract-provider/build/libs/fineract-provider.jar`, ~140 MB).
- `:fineract-provider:compileJava` and `:fineract-provider:compileTestJava` are both green under
  `-Werror`.
- **The one remaining blocker for a full `./gradlew build` is the `fineract-client` generated SDK**
  (see 8.7). It is caused by the forced `org.openapi.generator` 4.3.1 -> 6.6.0 upgrade (4.3.1 does not
  run on Gradle 8), which changed OpenAPI tag->class naming and multipart handling. This is documented
  as a residual blocker with options rather than worked around with risky hand edits.
- Provider unit tests were not executed as part of this record (they require a provisioned
  MariaDB/MySQL tenant DB); this is called out in the remaining-work list.

### 8.1 Provider compile errors (initial 113 -> 0)

The first `:fineract-provider:compileJava` after Phases 1-7 failed with 113 errors. Fixed by:

- **Legacy Jackson 1.x** (`org.codehaus.jackson.*`) is still imported by template / interop / campaign
  classes and used to arrive transitively. Pinned `jackson-mapper-asl` / `jackson-core-asl` `1.9.13`
  in root `dependencyManagement` and added `jackson-mapper-asl` to provider deps. **Tech debt:**
  migrating this code to Jackson 2 is follow-up work; it is only kept alive to compile.
- **Jakarta Mail**: `jakarta.mail.*` was missing. Added `spring-boot-starter-mail` (Jakarta Mail 2.1)
  to the provider.
- **JMS namespace**: the Spring Boot 3.2 BOM selected `activemq-client:5.18.4`, which exposes
  `javax.jms`. Pinned `activemq-broker` / `activemq-client` / `activemq-openwire-legacy` to `6.1.4`
  (first Jakarta-JMS ActiveMQ line) in `dependencyManagement`.
- **Tomcat 10.1 SSL API**: `Http11NioProtocol#setKeystoreFile/#setKeystorePass` were removed. Rewrote
  `EmbeddedTomcatWithSSLConfiguration` to use `SSLHostConfig` + `SSLHostConfigCertificate`.
- **Spring 6 `HttpStatusCode`**: `HttpStatus#name()` is gone from the returned type. Log the status
  object directly in `SmsMessageScheduledJobServiceImpl`.

### 8.2 Error Prone 2.6.0 -> 2.28.0 (JDK 21 support)

Error Prone 2.6.0 cannot parse JDK 21 sources; bumped `error_prone_core` to `2.28.0`. Consequences:

- 2.28 needs a newer Guava than the BOM-forced `30.1.1` and crashed with
  `ImmutableMap$Builder.buildOrThrow()` `NoSuchMethodError`. Pinned Guava `33.2.1-jre`.
- `PublicConstructorForAbstractClass` no longer exists (folded into
  `InjectOnConstructorOfAbstractClass`) — removed from the configured checkers.
- Many **new** checks fire on pre-existing code. Because the build runs `-Werror`, each would fail the
  build. They are unrelated to this migration, so they are disabled (with counts) as prioritized
  follow-up cleanup, not fixed blindly: `NotJavadoc` (182), `PreferredInterfaceType` (231, disabled via
  a raw `-Xep:PreferredInterfaceType:OFF` arg because `disable()` did not suppress it),
  `PatternMatchingInstanceof` (21), `OperatorPrecedence` (19), `ReturnValueIgnored` (18),
  `DirectInvocationOnMock` (10), `UnnecessaryStringBuilder` (5), `StringCaseLocaleUsage` (4),
  `UnnecessaryLongToIntConversion` (4), `ReturnAtTheEndOfVoidFunction` (4), `AlreadyChecked`,
  `NonApiType`, `NarrowCalculation` (1), `LongDoubleConversion` (1), `DoNotCall` (1),
  `SystemConsoleNull`, `UnusedMethod` (7). The two numeric checks (`NarrowCalculation`,
  `LongDoubleConversion`) and `AlreadyChecked` are worth a human look — they can hide real bugs.
- A handful were fixed in place instead of disabled: one `AlreadyChecked` in `Office.java`
  (`match = result` -> `match = true` where `result` is known true), two `UnnecessaryParentheses`
  (`throw (e)` -> `throw e`) in `PortfolioCommandSourceWritePlatformServiceImpl`, one `NotJavadoc` in
  `LoanProduct.java`, and a `BadImport` avoided by not importing the nested
  `SSLHostConfigCertificate.Type`.

### 8.3 Deprecation lint

Spring 6 raises ~75 deprecation warnings (mostly `JdbcTemplate` query overloads and Spring API moves).
With `-Werror` these are fatal. Removed `-Xlint:deprecation` and set `options.deprecation = false` for
the migration. **Re-enabling deprecation lint and cleaning these up is explicit follow-up work** — the
warnings are real, just out of scope for a namespace/version migration.

### 8.4 OpenJPA enhancer (Phase 4 residual risk) — RESOLVED

The Phase 4 note flagged the retained `com.radcortez:openjpa-gradle-plugin:3.2.0` enhancer as a likely
blocker. In practice `:fineract-provider:resolve`/enhancement runs cleanly with OpenJPA 4.0.0 on
JDK 21 once the classpath is correct. The failure that first looked like an enhancer problem was
actually a Swagger classpath issue (`NoClassDefFoundError: io/swagger/v3/oas/annotations/Webhooks`):
the pinned `swagger-annotations` was `2.1.8` but the swagger tooling is `2.2.x`. Bumped
`io.swagger.core.v3:swagger-annotations` to `2.2.20`. After that the enhancer and spec generation both
succeed, so **no direct `PCEnhancer` fallback was needed.**

### 8.5 Gradle 8 strict task-dependency validation

Gradle 8 turns "task A consumes task B's output without declaring a dependency" into a hard error.
Several long-standing implicit dependencies had to be made explicit:

- `:fineract-provider:resolveMainClassName` / `bootJar` consume the classes dir that the Swagger
  `resolve` task writes into -> added `dependsOn 'resolve'`.
- `:fineract-client:buildJavaSdk` / `buildTypescriptAngularSdk` consume the provider-generated
  `fineract.yaml` -> added explicit `dependsOn` on `:fineract-provider:resolve` and `processResources`.
- `licenseFormatBuildScripts` scans the whole `$rootDir` tree, overlapping `rat` and the `spotless*`
  tasks; and generators emit `.sh` scripts under `build/` -> excluded `**/build/**` etc. from its
  source and declared `dependsOn` on the root `rat` + `spotless*` tasks.
- The license plugin's auto-created `licenseFormatGenerated` (for the `generated` sourceSet) consumes
  `buildJavaSdk` output -> declared the dependency.

### 8.6 Swagger/OpenAPI spec generation on Jakarta

The Swagger gradle plugin's `:resolve` task instantiates `io.swagger.v3.jaxrs2.Reader` **from the
project runtime classpath** (the plugin jar itself only depends on commons-lang3). The default
`swagger-jaxrs2` reader only understands `javax.ws.rs`; after the Jersey 3 / `jakarta.ws.rs` migration
it scanned zero resources and emitted a 38-line, path-less spec, which in turn starved the generated
client SDK of all models. Fix: add `io.swagger.core.v3:swagger-jaxrs2-jakarta:2.2.20` to the provider
runtime. The spec then generates fully (~44k lines, 693 operations).

### 8.7 `fineract-client` generated SDK — RESIDUAL BLOCKER

Root cause: Phase 1 had to bump `org.openapi.generator` from `4.3.1` to `6.6.0` because 4.3.1 does not
run on Gradle 8 / JDK 21. The 6.x generator changed two things the committed, hand-written client
wrapper code depends on:

1. **Tag -> API class naming.** e.g. the `@Tag(name = "Self User")` resource now generates
   `SelfUserApi`, but the hand-written `FineractClient` (unchanged from baseline) imports
   `SelfUserDetailsApi`; likewise `FetchAuthenticatedUserDetailsApi` no longer exists under that name.
2. **Multipart handling.** 4.3.1 generated model POJOs for the Jersey multipart types
   `FormDataBodyPart` / `FormDataContentDisposition`; 6.6.0 references them but does not generate them,
   so the generated `DocumentsApi` and the hand-written `ImagesApi` / `DocumentsApiFixed` /
   `RunReportsApi` no longer compile (~48 residual `cannot find symbol` errors).

Two smaller SDK fixes that WERE applied and are correct:
- `useJakartaEe: 'true'` in the generator config (the generated code used `javax.annotation.Generated`,
  which the JDK removed) + `jakarta.annotation:jakarta.annotation-api` on the client.
- `org.apache.oltu.oauth2.client` is used only by the generated `OAuthOkHttpClient`; Phase 6 dropped
  `oltuVersion` from root dependency management (server side), so its version is now pinned inline in
  the client (`1.0.1`, the last Oltu release).

**Why this is left as a documented blocker rather than forced:** making the SDK compile requires either
(a) editing multiple committed hand-written wrapper source files to chase the new generated names and
inventing a multipart representation for the retrofit2 client, or (b) customising the OpenAPI generator
templates/`typeMappings`. Both are non-trivial, easy to get subtly wrong, and outside a
namespace/version migration. Per the brief ("prefer documenting the blocker and options over forcing
risky changes"), the options are:

- **Option A (recommended):** treat the client SDK as a follow-up task — reconcile `FineractClient` and
  the hand-written `*Api` helpers with the 6.6.0 output, and add `typeMappings`/`importMappings` (or a
  small custom template) so multipart file params map to `okhttp3.MultipartBody.Part`.
- **Option B:** find an `org.openapi.generator` version that both runs on Gradle 8 and preserves the
  4.3.1 naming/multipart behaviour (uncertain one exists; would need a version sweep).
- **Option C:** if the published Java SDK is not needed for the server migration, temporarily drop
  `fineract-client` from the default `build` and publish it separately once reconciled.

### 8.8 Import ordering (mechanical)

The Phase 3 `javax.*`->`jakarta.*` rewrite left imports out of the order Spotless enforces
(`jakarta` sorts before `java`), so `spotlessCheck` (part of `build`) failed across the tree.
`./gradlew spotlessApply` normalised ~390 files. This is committed separately from the functional
Phase 8 work so the mechanical churn does not obscure the real changes.

### 8.9 Prioritized remaining work

1. **`fineract-client` SDK** — reconcile with openapi-generator 6.6.0 (see 8.7, Option A). Blocks a
   full `./gradlew build`.
2. **OAuth2 authorization server** (Phase 6) — still needs the architectural decision
   (Spring Authorization Server vs external IdP vs basic-auth-only).
3. **Provider tests** — run `:fineract-provider:test` / integration tests against a real tenant DB;
   they were not exercised in this record.
4. **Jackson 1.x -> 2** — remove the `org.codehaus.jackson` compatibility pins (8.1).
5. **Re-enable deprecation lint** and clean up the ~75 Spring 6 deprecations (8.3).
6. **Review the disabled Error Prone checks** (8.2), especially `NarrowCalculation`,
   `LongDoubleConversion`, `AlreadyChecked` (possible real bugs), and the 231 `PreferredInterfaceType`.
7. **Validate ActiveMQ 6.1.4 at runtime** (wire compatibility with any external brokers).
