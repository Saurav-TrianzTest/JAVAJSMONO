# =============================================================================
# Multi-Stage Dockerfile for react-nextjs-host (Java 17 Maven Application)
# Builder : maven:3.9.4-eclipse-temurin-17
# Runtime : amazoncorretto:17
# =============================================================================

# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM maven:3.9.4-eclipse-temurin-17 AS builder

WORKDIR /workspace

# Copy build descriptor first for dependency-layer caching
COPY pom.xml .

# Pre-download all dependencies (cached unless pom.xml changes)
RUN mvn dependency:go-offline -B

# Copy the rest of the source tree and build the JAR
COPY src ./src

RUN mvn clean package -DskipTests -B

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM amazoncorretto:17

# Timezone and locale
ENV TZ=UTC \
    LANG=en_US.UTF-8 \
    LANGUAGE=en_US:en \
    LC_ALL=en_US.UTF-8

# JVM tuning – container-aware heap sizing
ENV JAVA_OPTS="-XX:+UseContainerSupport \
               -XX:MaxRAMPercentage=75.0 \
               -XX:InitialRAMPercentage=50.0 \
               -XX:+UnlockExperimentalVMOptions \
               -Djava.security.egd=file:/dev/./urandom \
               -Dfile.encoding=UTF-8"

# Application port
ENV APP_PORT=8080

WORKDIR /app

# Create a non-root user for security
RUN groupadd --system appgroup && \
    useradd  --system --gid appgroup --no-create-home appuser

# Copy the fat JAR from the builder stage
COPY --from=builder /workspace/target/react-nextjs-host.jar app.jar

# Ensure the non-root user owns the application files
RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 8080

# Graceful shutdown via exec form (PID 1 receives SIGTERM)
ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar /app/app.jar"]
