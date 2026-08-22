# =============================================================================
# Multi-Stage Dockerfile for react-nextjs-host (Java 17 / Maven)
# Runtime base image: mcr.microsoft.com/openjdk/jdk:17-ubuntu (explicit)
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Build – Maven + Eclipse Temurin 17
# ---------------------------------------------------------------------------
FROM maven:3.9.4-eclipse-temurin-17 AS builder

WORKDIR /workspace

# Copy dependency manifest first to leverage Docker layer caching
COPY pom.xml .

# Download all dependencies offline so subsequent builds are faster
RUN mvn dependency:go-offline -B

# Copy the full source tree (wrapper files are excluded via .dockerignore)
COPY src ./src

# Build the application JAR (skip tests for Docker build)
RUN mvn clean package -DskipTests -B

# ---------------------------------------------------------------------------
# Stage 2: Runtime – Microsoft OpenJDK 17 on Ubuntu (explicit base image)
# ---------------------------------------------------------------------------
FROM mcr.microsoft.com/openjdk/jdk:17-ubuntu

# Timezone configuration
ENV TZ=UTC
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# Create a non-root user for security
RUN groupadd --system appgroup && useradd --system --gid appgroup --shell /bin/false appuser

WORKDIR /app

# Copy the built JAR from the builder stage
COPY --from=builder /workspace/target/react-nextjs-host.jar app.jar

# Set ownership
RUN chown -R appuser:appgroup /app

# Switch to non-root user
USER appuser

# JVM tuning: container-aware memory management
ENV JAVA_OPTS="-Xmx512m -Xms256m \
  -XX:+UseContainerSupport \
  -XX:MaxRAMPercentage=75.0 \
  -XX:+UseG1GC \
  -Djava.security.egd=file:/dev/./urandom \
  -Dfile.encoding=UTF-8 \
  -Duser.timezone=UTC"

# Application port
EXPOSE 8080

# Graceful shutdown via exec form (PID 1 receives SIGTERM)
ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar /app/app.jar"]
