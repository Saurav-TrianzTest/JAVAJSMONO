# =============================================================================
# Multi-Stage Dockerfile — react-nextjs-host (Java 17 / Maven)
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1 — Builder
# Uses the official Maven + Eclipse Temurin 17 image to compile the project.
# All build tooling stays in this stage and is NOT carried into the runtime.
# -----------------------------------------------------------------------------
FROM maven:3.9.4-eclipse-temurin-17 AS builder

WORKDIR /workspace

# Copy dependency manifest first to leverage Docker layer caching.
# Dependencies are downloaded before source code is copied so that
# source-only changes do not invalidate the dependency layer.
COPY pom.xml .
RUN mvn dependency:go-offline -B

# Copy the full source tree and build the production JAR.
COPY src ./src
RUN mvn clean package -DskipTests -B

# -----------------------------------------------------------------------------
# Stage 2 — Runtime
# Minimal Eclipse Temurin 17 JDK image (explicit base image as requested).
# Only the compiled JAR is copied from the builder stage.
# -----------------------------------------------------------------------------
FROM eclipse-temurin:17-jdk

# Create a non-root user for security best practices.
RUN groupadd --system appgroup && useradd --system --gid appgroup appuser

WORKDIR /app

# Copy the compiled JAR from the builder stage.
COPY --from=builder /workspace/target/react-nextjs-host.jar app.jar

# Set ownership so the non-root user can read the JAR.
RUN chown -R appuser:appgroup /app

USER appuser

# JVM tuning: container-aware memory settings.
ENV JAVA_OPTS="-XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0 -Xms256m -Xmx512m -XX:+ExitOnOutOfMemoryError"

# Timezone configuration.
ENV TZ=UTC

# Application port (matches Application.java).
EXPOSE 8080

# Graceful shutdown: use exec form so the JVM receives SIGTERM directly.
ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar /app/app.jar"]
