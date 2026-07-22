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
