# N-1 LTS Upgrade Notes — Java 11 → Java 21 (staged, supervised)

**Branch:** `security/n-1-lts-java21` (branched from `demo/java11-baseline`)
**Status:** Staged pass — tooling/target bumped to Java 21, build attempted, breakage
captured below. **Not** a full Spring Boot 2→3 / Jakarta migration. Human review required
before deciding scope.

---

## 1. The N / N-1 LTS decision

- **N (latest LTS):** Java 25
- **N-1 (target for this upgrade):** **Java 21**

Security policy targets the "N-1 LTS" so the platform stays on a supported LTS one step
behind the newest, balancing currency with ecosystem stability. This pass moves the Java
source/target and the minimum build tooling to Java 21 to expose what breaks; it does not
attempt to make the application compile/run on Java 21.

---

## 2. Files changed and why

| File | Change | Reason |
|------|--------|--------|
| `build.gradle` (~L368–370) | `sourceCompatibility` / `targetCompatibility`: `VERSION_11` → `VERSION_21` | Core of the upgrade — set the Java language/binary target to Java 21. |
| `gradle/wrapper/gradle-wrapper.properties` | `gradle-6.9-bin.zip` → `gradle-8.7-bin.zip` | Gradle 6.9 cannot run on / target Java 21. Gradle 8.5+ is required for Java 21; 8.7 chosen. |
| `Dockerfile` | builder `FROM openjdk:11` → `FROM eclipse-temurin:21`; runtime `FROM gcr.io/distroless/java:11` → `FROM gcr.io/distroless/java21-debian12` | Build and run the container on a Java 21 JDK/JRE. `openjdk:11` and `distroless/java:11` have no Java 21 tag; `eclipse-temurin:21` and `distroless/java21-debian12` are the current equivalents. |
| `.travis.yml` (`before_install`) | `openjdk-11-jdk-headless` → `openjdk-21-jdk-headless`; `JAVA_HOME=.../java-11-openjdk-amd64` → `.../java-21-openjdk-amd64`; comment updated | CI must install and export a Java 21 JDK. |
| `.travis.yml` | `dist: bionic` → `dist: jammy` | Ubuntu 18.04 (`bionic`) apt archives have no `openjdk-21` package, so `apt-get install openjdk-21-jdk-headless` would abort in `before_install` and mask the real build failure. Ubuntu 22.04 (`jammy`) provides `openjdk-21-jdk-headless`. |

### Deliberately NOT changed

- **`fineract-client/build.gradle`** stays on **`JavaVersion.VERSION_1_8`** (Java 8),
  intentionally pinned per **FINERACT-1214** (the published client SDK must remain
  Java 8 compatible for downstream consumers). Left untouched on purpose.

### Deviation from the original step list (needs reviewer sign-off)

- **`build.gradle` — `jcenter()` → `mavenCentral()`** in both `repositories` blocks
  (buildscript classpath block and `allprojects`). This was **not** in the original step
  list but is unavoidable "minimum build tooling": JFrog **Bintray/JCenter was shut down**,
  so `jcenter()` resolves nothing and the build fails during *configuration*, before any
  Java-version behavior can be observed. This blocker exists regardless of Java version —
  the Java 11 build no longer resolves on this branch either. Switching to `mavenCentral()`
  lets most artifacts resolve and moves the failure forward (see §3). Flagging explicitly
  for the human-in-the-loop.

- **Build-plugin version bumps + Gradle 8 build-script fixes (the "Option B" second pass).**
  After the reviewer approved going one step further to reveal deeper breakage, the following
  additional changes were made *purely to get the build past configuration so `compileJava`
  could be attempted*. These are still short of the Spring Boot / Jakarta migration:
  - `com.radcortez.gradle:openjpa-gradle-plugin` `3.1.0` → `3.2.0` (available on the Gradle
    Plugin Portal, which is already a declared repository).
  - `com.gorylenko.gradle-git-properties` `2.2.4` → `2.4.1` (its transitive
    `org.ajoberstar.grgit:grgit-core` version is on Maven Central).
  - `org.asciidoctor.jvm.*` (convert/pdf/epub/revealjs/gems) `3.3.2` → `4.0.5` (drops the
    `com.burgstaller:okhttp-digest:1.10` transitive that was jcenter-only).
  - Gradle 6→8 build-script API removals fixed (Gradle 8.7 is required for Java 21):
    - `build.gradle`: `sourceSets.*.java.outputDir` → `.classesDirectory`.
    - `build.gradle`: `jacoco { reportsDir = ... }` → `reportsDirectory`.
    - `build.gradle`: `jacocoTestReport` reports `html/xml.enabled` → `.required`,
      `html.destination` → `html.outputLocation`.
    - `build.gradle`: removed `apply plugin: 'maven'` (legacy `maven` plugin removed in
      Gradle 7; `maven-publish` is already applied).
    - `fineract-doc/build.gradle`: `archiveName "..."` → `archiveFileName = "..."`.
  See §3d for how far this got and the hard wall it hit (§3e).

---

## 3. Build attempt & observed breakage

Commands (run with `JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64`, OpenJDK 21.0.11):

```
./gradlew --no-daemon help
./gradlew --no-daemon compileJava
```

### 3a. Gradle wrapper bump: OK

`gradle-8.7-bin.zip` downloaded and ran on Java 21 successfully — the wrapper/tooling half
of the upgrade works. Gradle also emitted a deprecation warning that this build is
**incompatible with Gradle 9.0** (deprecated features in the build scripts/plugins).

### 3b. Configuration FAILS — jcenter-only plugin artifacts are unresolvable (current blocker)

With `jcenter()` (before the repo change) **every** classpath artifact failed to resolve
(JCenter is gone). After switching to `mavenCentral()`, three build-plugin artifacts still
fail because they were **only ever published to JCenter and were never mirrored to Maven
Central**:

```
> Could not resolve all artifacts for configuration ':classpath'.
   > Could not find com.radcortez.gradle:openjpa-gradle-plugin:3.1.0.
         Required by: project :
   > Could not find org.ajoberstar.grgit:grgit-core:4.1.0.
         Required by: project : > com.gorylenko.gradle-git-properties:...:2.2.4
                                > gradle.plugin.com.gorylenko.gradle-git-properties:gradle-git-properties:2.2.4
   > Could not find com.burgstaller:okhttp-digest:1.10.
         Required by: project : > org.asciidoctor.jvm.gems:...:3.3.2 > ... > io.github.http-builder-ng:http-builder-ng-okhttp:1.0.3
```

Verified directly against Maven Central:

- `com.radcortez.gradle:openjpa-gradle-plugin` — **group absent** from Maven Central (404).
- `org.ajoberstar.grgit:grgit-core` — group exists, but **version `4.1.0` is absent** (404).
- `com.burgstaller:okhttp-digest:1.10` — **absent** (404); this artifact later moved to
  the `io.github.rburgst` group.

Because these are **buildscript-classpath / applied-plugin** dependencies, they block
`configure` of the root project, so **`compileJava` never runs** — both `help` and
`compileJava` fail identically at configuration time (`BUILD FAILED`).

### 3c. Note on §3b

§3b was the state at the end of the *first* pass. The reviewer then approved "Option B"
(swap the jcenter-only plugins to push further). §3d–§3e below record the second pass.

### 3d. Option B — configuration now progresses past dependency resolution

With the plugin bumps (§2), the `:classpath` resolves and Gradle proceeds to *evaluate* the
build scripts. This surfaced a sequence of **Gradle 6→8 build-script API removals** (Gradle
8.7 is required for Java 21), each fixed in turn (see §2 list). After those fixes, evaluation
reached the individual subprojects — i.e. we got **much further than §3b**.

### 3e. Option B — HARD WALL: Spring Boot Gradle plugin 2.3.5 is incompatible with Gradle 8.7

Evaluating `fineract-provider` fails the moment the Spring Boot plugin is applied
(`fineract-provider/build.gradle:23` → `apply plugin: 'org.springframework.boot'`):

```
* Where: Build file '.../fineract-provider/build.gradle' line: 23
* What went wrong:
A problem occurred evaluating project ':fineract-provider'.
> 'void org.gradle.api.internal.artifacts.dsl.LazyPublishArtifact.<init>(org.gradle.api.provider.Provider)'

Caused by: java.lang.NoSuchMethodError:
  'void org.gradle.api.internal.artifacts.dsl.LazyPublishArtifact.<init>(org.gradle.api.provider.Provider)'
    at org.springframework.boot.gradle.plugin.JavaPluginAction.configureArtifactPublication(JavaPluginAction.java:123)
    at org.springframework.boot.gradle.plugin.JavaPluginAction.execute(JavaPluginAction.java:79)
    at org.springframework.boot.gradle.plugin.SpringBootPlugin.apply(SpringBootPlugin.java:93)
```

**Root cause:** the Spring Boot Gradle plugin **2.3.5.RELEASE** calls a Gradle *internal*
constructor `new LazyPublishArtifact(Provider)` that **no longer exists in Gradle 8** (its
signature changed). The Spring Boot 2.3.5 plugin only supports Gradle ~5–6; it cannot run on
the Gradle 8.7 that Java 21 requires. This is a **hard, unavoidable** coupling:

> Java 21 ⇒ Gradle 8.5+ ⇒ a Gradle-8-compatible Spring Boot Gradle plugin ⇒ Spring Boot 2.7+/3.x.

So the very act of adopting Gradle for Java 21 forces a Spring Boot upgrade. This is the
concrete, reproducible manifestation of the "Spring Boot 2.3.5 does not support Java 21"
breakage the exercise set out to capture.

### 3f. Still NOT reached: `javax`→`jakarta` compile errors

`compileJava` for `fineract-provider` **still does not run**, because configuration dies at
§3e before any compilation task executes. The expected `javax.*` → `jakarta.*` source-level
errors would only appear *after* the Spring Boot plugin/BOM is upgraded to a Spring Boot 3.x
line (which moves the managed dependencies onto the `jakarta.*` namespace). Note: under
Spring Boot **2.x** (Spring 5.3.x, still `javax.*`) the code and its dependencies are
namespace-consistent, so the dominant Java-21 blocker for *this* stack is the **build-tooling
/ Spring Boot Gradle plugin** layer (§3e), not source-level `javax`/`jakarta` mismatches —
those become relevant only once the Spring Boot 2→3 migration is undertaken.

---

## 4. Recommended next scope for the human reviewer

Everything below is the **out-of-scope migration** this staged pass deliberately stops before:

1. **Upgrade Spring Boot** to a Gradle-8-compatible line. Practically this means **Spring
   Boot 3.x** (3.2+ recommended for Java 21 support), because Spring Boot 2.x plugins do not
   reliably support Gradle 8. This drags in:
   - Spring Framework 6.x, and the **Jakarta EE 9+ namespace migration** (`javax.*` →
     `jakarta.*`) across the entire `fineract-provider` codebase (persistence, servlet, JAXB,
     validation, JMS, etc.).
   - **OpenJPA 3.2.0** compatibility review — OpenJPA is still on `javax.persistence`; a
     `jakarta.persistence` provider (or a newer OpenJPA / alternative such as Hibernate) will
     likely be required.
   - Dependency-management/BOM churn and likely upgrades to many transitive libraries.
2. Re-verify the OpenJPA enhance step (`openjpa-gradle-plugin`, now 3.2.0) against whichever
   persistence namespace is chosen.
3. Then `./gradlew --no-daemon compileJava` on Java 21 will finally reach source compilation
   and expose the `javax`→`jakarta` errors to be worked through.

---

## 5. Summary

- Java source/target, Gradle wrapper (8.7), Dockerfile, and Travis CI (`dist: jammy`) moved
  to Java 21. `fineract-client` intentionally left on Java 8 (FINERACT-1214).
- The Gradle 8.7 wrapper runs on Java 21 — the tooling half works.
- **First pass** stopped at dependency resolution: **JCenter shutdown** + three jcenter-only
  build-plugin artifacts unavailable on Maven Central.
- **Second pass (Option B, reviewer-approved)** swapped those plugins and fixed five Gradle
  6→8 build-script API removals, getting configuration much further — then hit a **hard wall**:
  the **Spring Boot Gradle plugin 2.3.5.RELEASE cannot run on Gradle 8.7**
  (`NoSuchMethodError: LazyPublishArtifact.<init>(Provider)` in
  `JavaPluginAction.configureArtifactPublication`).
- Consequence: `compileJava` is still unreachable, so `javax`→`jakarta` *source* errors are
  not yet visible; the dominant blocker for this stack is the build-tooling / Spring Boot
  plugin layer.
- **Reaching compileJava requires upgrading Spring Boot (→ 3.x) and the full Jakarta
  namespace migration** — explicitly out of scope. Stopping here for human-decided scope.
