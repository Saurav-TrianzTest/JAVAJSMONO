# react-nextjs-host

A single-module Java (Maven) application that hosts the React + Next.js
containerization rule fixture defined in `TRUTH_SOURCE_OF_TRUTH.txt`.

## Structure

One `pom.xml` at the repo root — no other build manifests (no `package.json`,
no nested/multi-module POMs) so the repo reads as a plain, enterprise-shaped
single Java application.

- **Java host app** — `src/main/java/com/trianz/reactnextjs/`
  (`Application`, `controller/HealthController`, `service/HealthService`).
  Uses only built-in JDK APIs (`com.sun.net.httpserver`), so it builds and
  runs with zero external dependencies or network access.
  Build: `mvn package` → run: `java -jar target/react-nextjs-host.jar`.
  Tests: `src/test/java`, run with `mvn test` (JUnit 5, test-scope only).

- **React + Next.js fixture files** — retained exactly as provided, at their
  original paths and line numbers, so every entry in
  `TRUTH_SOURCE_OF_TRUTH.txt` (`cz-js-1024` .. `cz-js-1047`) still resolves
  correctly: `.env`, `Dockerfile`, `Dockerfile.prod`, `server.js`,
  `pages/api/health.js`, `public/config.js`, and everything under `src/`
  outside `src/main` and `src/test` (`src/index.js`, `src/build.note.js`,
  `src/api/`, `src/store/`, `src/config/`, `src/components/`). These files
  are not compiled or referenced by the Java build — they exist purely to
  be scanned for the seeded cz-js violations.

`package.json` was intentionally removed — no rule in the TRUTH doc
references it, and keeping both `pom.xml` and `package.json` at the repo
root causes the repo to be misread as a multi-module (Java + Node) project
instead of a single Java application with embedded JS/TS source.
