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
