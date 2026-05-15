FROM python:3.12-slim

WORKDIR /app
COPY .dev/local/builder/server.py /app/server.py

EXPOSE 4010
CMD ["python", "/app/server.py"]