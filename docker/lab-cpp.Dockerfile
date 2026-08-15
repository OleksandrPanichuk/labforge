FROM gcc:14

RUN useradd --uid 1000 --create-home lab || true
USER 1000:1000
WORKDIR /job
