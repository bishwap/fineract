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

### 3c. NOT yet observed (blocked by 3b)

The intended target of this pass — **Java 21 compile errors from Spring Boot 2.3.5.RELEASE,
Spring Framework 5.3.7, OpenJPA 3.2.0, and `javax.*` → `jakarta.*` namespace issues** —
**could not be reached**, because the build fails during configuration (§3b) before any
source is compiled. These will only surface once the jcenter-only build plugins are replaced
so the project can be configured and `compileJava` can run.

---

## 4. Recommended next scope for the human reviewer

To get past the current configuration blocker and reveal the real Java 21 / Spring / Jakarta
breakage, the reviewer will need to decide on (all beyond this staged pass):

1. Replace / upgrade the three jcenter-only build plugins:
   - `com.radcortez.gradle:openjpa-gradle-plugin:3.1.0` → a Maven Central-available OpenJPA
     enhancement approach (newer radcortez release or alternative), **or** drop it and wire
     OpenJPA enhancement differently.
   - `com.gorylenko.gradle-git-properties` → a newer version whose transitive
     `org.ajoberstar.grgit:grgit-core` is on Maven Central.
   - Asciidoctor gems chain pulling `com.burgstaller:okhttp-digest:1.10` → newer asciidoctor
     plugins, or exclude/remap to `io.github.rburgst:okhttp-digest`.
2. Then re-run `./gradlew --no-daemon compileJava` on Java 21 to capture the expected
   Spring Boot 2.3.5 / OpenJPA / `javax`→`jakarta` errors.
3. The likely large follow-up: **Spring Boot 2→3 + Jakarta EE 9+ namespace migration**
   (`javax.*` → `jakarta.*`), OpenJPA compatibility, and dependency upgrades. Explicitly
   out of scope for this staged pass.

---

## 5. Summary

- Java source/target, Gradle wrapper, Dockerfile, and Travis CI were moved to Java 21.
- `fineract-client` intentionally left on Java 8 (FINERACT-1214).
- The Gradle 8.7 wrapper runs on Java 21; the tooling half works.
- The build currently fails at **configuration** due to **JCenter shutdown** + three
  **jcenter-only build-plugin artifacts** unavailable on Maven Central — this blocks
  `compileJava`, so Spring/OpenJPA/Jakarta compile errors are **not yet visible**.
- Stopping here per instructions: document breakage, defer the Spring/Jakarta migration
  (and the build-plugin replacements) to human-decided scope.
