APP_NAME := "ryder"
CMD_DIR := ./cmd/$(APP_NAME)
PKG_DIR := ./...
VERSION := $(shell git describe --tags --always --dirty)

.PHONY: all

all: build

build:
	@echo "Building $(APP_NAME)..."
	go build -ldflags "-X main.version=$(VERSION)" -o bin/$(APP_NAME) $(CMD_DIR)

build-linux:
	@echo "Building $(APP_NAME) for Linux..."
	CC=x86_64-linux-gnu-gcc GOOS=linux GOARCH=amd64 CGO_ENABLED=1 go build -ldflags "-X main.version=$(VERSION)" -o bin/$(APP_NAME)-linux $(CMD_DIR)

run:
	@echo "Running $(APP_NAME)..."
	go run $(CMD_DIR)

test:
	@echo "Running tests..."
	go test -v $(PKG_DIR)

lint:
	@echo "Linting code..."
	golangci-lint run $(PKG_DIR)

clean:
	@echo "Cleaning up..."
	rm -rf bin/

docs:
	@echo "Generating Swagger docs..."
	swagger generate spec -o ./api/docs/swagger.yaml --scan-models

migrate-up:
	@echo "Running DB migrations up..."
	migrate -path migrations -database $(DB_URL) up

migrate-down:
	@echo "Rolling back DB migrations..."
	migrate -path migrations -database $(DB_URL) down
