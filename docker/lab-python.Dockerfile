FROM python:3.12-slim

RUN pip install --no-cache-dir \
      numpy==2.1.3 \
      scipy==1.14.1 \
      matplotlib==3.9.2 \
      pandas==2.2.3 \
      sympy==1.13.3

RUN useradd --uid 1000 --create-home lab
USER 1000:1000
WORKDIR /job
