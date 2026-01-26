# Share Web | My Cloud

A lightweight, self-hosted file sharing platform built with Django and Docker.
Simple, fast, and supports drag-and-drop uploads.

![Docker Image Size (latest)](https://img.shields.io/docker/image-size/kpoier/share-web-django/latest)
![Docker Pulls](https://img.shields.io/docker/pulls/kpoier/share-web-django)

## 🚀 Features

- **File Management**: Upload, rename, delete, and download files.
- **Folder Support**: Create folders and upload entire directory structures.
- **Drag & Drop**: Full-screen drag-and-drop support.
- **Preview**: Inline preview for images, code, and PDFs.
- **Responsive**: Works perfectly on Desktop, Tablet, and Mobile.
- **Dockerized**: Automated CI/CD pipeline builds to Docker Hub.

## 🛠 Tech Stack

- **Backend**: Django 5.2 (Python 3.12)
- **Database**: SQLite (Simple & Portable)
- **Frontend**: Bootstrap 5 + Vanilla JS
- **Server**: WhiteNoise (Static files) + Gunicorn (Production ready)

## 🐳 Local Development (開發環境)

1. **Clone the repo**
   ```bash
   # Replace YOUR_GITHUB_USERNAME with your actual GitHub username
   git clone [https://github.com/YOUR_GITHUB_USERNAME/share-web-django.git](https://github.com/YOUR_GITHUB_USERNAME/share-web-django.git)
   cd share-web-django

```

2. **Start with Docker Compose**
```bash
# Build locally and start
docker-compose -f docker/docker-compose.yml up --build

```


3. **Access**
Open [http://localhost:8000](https://www.google.com/search?q=http://localhost:8000)

---

## 📦 Server Deployment (伺服器部署)

This project is configured to automatically push images to **[kpoier/share-web-django](https://www.google.com/search?q=https://hub.docker.com/r/kpoier/share-web-django)** on Docker Hub whenever changes are pushed to the `master` branch.

### 1. Create `docker-compose.yml` on Server

You **do not** need the source code on your server. Just create this single file:

```yaml
version: '3.8'

services:
  web:
    # Pulls the latest image from your Docker Hub
    image: kpoier/share-web-django:latest
    
    container_name: my_cloud_web
    restart: always
    
    ports:
      - "8000:8000"
    
    volumes:
      # Persist data (Ensure these files/folders exist relative to this yaml)
      - ./db.sqlite3:/app/db.sqlite3
      - ./uploads:/app/uploads
    
    environment:
      - DEBUG=False
      - ALLOWED_HOSTS=*
      # Change this to a strong random string!
      - SECRET_KEY=change-this-to-a-secure-random-key-in-production
    
    # Auto collect static files & migrate DB on startup
    command: sh -c "python manage.py collectstatic --noinput && python manage.py migrate && python manage.py runserver 0.0.0.0:8000 --insecure"

```

### 2. Start the Server

```bash
# Ensure database file exists (Docker will create a folder otherwise)
touch db.sqlite3

# Start the container
docker-compose up -d

```

### 3. Update to Latest Version

When you push new code to GitHub, the CI/CD pipeline will update the image. To update your server:

```bash
# 1. Pull the new image
docker-compose pull

# 2. Restart container (Recreates it with the new image)
docker-compose up -d

```

## 🔄 CI/CD Pipeline

This repository uses **GitHub Actions** to automate the workflow:

1. Push to `master` branch.
2. GitHub builds the Docker image.
3. Image is pushed to `kpoier/share-web-django:latest` and tagged with the commit SHA.
