from django.contrib import admin
from .models import FileModel, Folder

@admin.register(Folder)
class FolderAdmin(admin.ModelAdmin):
    list_display = ('name', 'parent', 'id')
    search_fields = ('name',)

@admin.register(FileModel)
class FileModelAdmin(admin.ModelAdmin):
    list_display = ('filename', 'folder', 'uploaded_at', 'short_code', 'id')
    list_filter = ('uploaded_at', 'folder')
    search_fields = ('file', 'short_code')