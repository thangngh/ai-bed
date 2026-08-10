FROM python:3.11-slim

WORKDIR /app

# Without this, uvicorn's logs sit in the stdout buffer and `docker logs` shows
# nothing until the process exits -- which is exactly when you need them.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Non-root. The Engine writes nothing to disk -- no volume, no cache, no
# uploads -- so there is nothing for root to be needed for, and a container
# that runs as root turns any RCE in a dependency into host-adjacent access.
# Ownership is set explicitly because COPY lands files as root:root.
RUN adduser --system --no-create-home --uid 10001 engine \
    && chown -R engine /app
USER engine

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
