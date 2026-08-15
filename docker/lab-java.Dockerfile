FROM eclipse-temurin:21-jdk-alpine

RUN adduser -u 1000 -D lab || true
USER 1000:1000
WORKDIR /job
