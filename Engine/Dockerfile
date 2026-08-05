FROM python:3.11-slim

WORKDIR /app

# Without this, uvicorn's logs sit in the stdout buffer and `docker logs` shows
# nothing until the process exits -- which is exactly when you need them.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
