# Deploying ORA Scraper Service to VPS

This guide explains how to deploy the ORA Scraper Service to a Linux VPS (e.g., DigitalOcean, AWS EC2, Linode) using Docker.

## Prerequisites

1.  **VPS Access**: SSH access to your server (Ubuntu 20.04+ recommended).
2.  **Docker Installed**: The server must have Docker and Docker Compose installed.
3.  **Git Installed**: To clone the repository.
4.  **Firebase Credentials**: You need your `firebase-credentials.json` file.

## Step 1: Server Setup

Connect to your VPS:
```bash
ssh user@your-vps-ip
```

Install Docker (if not installed):
```bash
# Ubuntu
sudo apt update
sudo apt install docker.io docker-compose -y
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
# You might need to log out and log back in for group changes to take effect
```

## Step 2: Clone Repository

Clone the project to your desired directory:
```bash
git clone https://github.com/your-username/ora-scraper-service.git
cd ora-scraper-service
```

## Step 3: Configuration

Create the environment file:
```bash
cp .env.example .env
nano .env
```
Fill in your API keys (Firebase, Unsplash, Reddit) in the `.env` file.

Upload your `firebase-credentials.json` to the server:
*(Run this from your LOCAL machine)*
```bash
scp path/to/local/firebase-credentials.json user@your-vps-ip:/path/to/ora-scraper-service/
```

## Step 4: Deploy

Build and start the container:
```bash
docker-compose up -d --build
```

- `-d`: Runs in detached mode (background).
- `--build`: Forces a rebuild of the image (useful when code changes).

## Step 5: Verification

Check if the service is running:
```bash
docker-compose ps
```

View logs:
```bash
docker-compose logs -f
```

The service should now be accessible at `http://your-vps-ip:3000`.

## Updating the Service

To deploy new changes:

1.  Pull the latest code:
    ```bash
    git pull origin main
    ```
2.  Rebuild and restart:
    ```bash
    docker-compose up -d --build
    ```
