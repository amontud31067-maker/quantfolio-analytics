FROM python:3.11-slim

WORKDIR /app

# Install system dependencies required by scientific packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

COPY . .

# Set writable directories for non-root container environments (Hugging Face Spaces uid 1000)
ENV HOME=/tmp
ENV MPLCONFIGDIR=/tmp/mpl_cache
ENV PORT=7860
RUN chmod -R 777 /app

EXPOSE 7860

CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-7860}"]
