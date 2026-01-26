# Share Web | My Cloud

A lightweight, self-hosted file sharing platform built with Django and Docker.
Simple, fast, and supports drag-and-drop uploads.

## 🚀 Features

- **File Management**: Upload, rename, delete, and download files.
- **Folder Support**: Create folders and upload entire directory structures.
- **Drag & Drop**: Full-screen drag-and-drop support.
- **Preview**: Inline preview for images, code, and PDFs.
- **Responsive**: Works perfectly on Desktop, Tablet, and Mobile.
- **Dockerized**: Easy deployment with Docker Compose.

## 🛠 Tech Stack

- **Backend**: Django 5.2 (Python 3.12)
- **Database**: SQLite (Simple & Portable)
- **Frontend**: Bootstrap 5 + Vanilla JS
- **Server**: WhiteNoise (Static files) + Gunicorn (Production ready)

## 🐳 Local Development

1. **Clone the repo**
   ```bash
   git clone [https://github.com/YOUR_USERNAME/share-website-django.git](https://github.com/YOUR_USERNAME/share-website-django.git)
   cd share-website-django

```

2. **Start with Docker Compose**
```bash
# Build and start
docker-compose -f docker/docker-compose.yml up --build

```


3. **Access**
Open [http://localhost:8000](https://www.google.com/search?q=http://localhost:8000)

## 📦 Deployment

This project includes a GitHub Action workflow.
Any push to the `master` branch will automatically build and push the Docker image to Docker Hub.

### Server Update Command

```bash
# Pull the latest image and restart
docker-compose pull
docker-compose up -d

```