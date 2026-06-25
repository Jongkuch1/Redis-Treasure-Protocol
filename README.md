
# Redis Treasure Protocol (Dockerized)

## Requirements
- Docker
- Docker Compose

## Run the Lab

docker compose up --build

Server will be available at:
http://localhost:3000

## Redis CLI Access

docker exec -it redis-treasure-docker-redis-1 redis-cli

## Stop Containers

docker compose down
