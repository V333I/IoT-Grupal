FROM python:3.12-alpine

WORKDIR /app

RUN apk add --no-cache gcc musl-dev libffi-dev

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY gateway_rpi5.py .

RUN mkdir -p /data

CMD ["python", "-u", "gateway_rpi5.py"]
