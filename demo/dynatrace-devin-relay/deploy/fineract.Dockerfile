# Fineract build for the demo deploy. Mirrors the repo's root Dockerfile but
# uses eclipse-temurin base images, since Docker Hub removed the `openjdk:11`
# tag and `gcr.io/distroless/java:11`. Build context is the repo root.
FROM eclipse-temurin:11-jdk AS builder

RUN apt-get update -qq && apt-get install -y --no-install-recommends wget ca-certificates && rm -rf /var/lib/apt/lists/*

COPY . fineract
WORKDIR /fineract

RUN ./gradlew --no-daemon -q -x rat -x compileTestJava -x test -x spotlessJavaCheck -x spotlessJava bootJar

WORKDIR /fineract/libs
RUN wget -q https://repo1.maven.org/maven2/mysql/mysql-connector-java/8.0.23/mysql-connector-java-8.0.23.jar

# =========================================

FROM eclipse-temurin:11-jre AS fineract

COPY --from=builder /fineract/fineract-provider/build/libs /app
COPY --from=builder /fineract/libs /app/libs

WORKDIR /app

ENTRYPOINT ["java", "-Dloader.path=/app/libs/", "-jar", "/app/fineract-provider.jar"]
