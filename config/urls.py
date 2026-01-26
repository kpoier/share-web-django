from django.contrib import admin
from django.urls import path, re_path
from django.conf import settings
from django.views.static import serve

# 引入 Core App 的 Views
from core.views import (
    path_resolver, 
    download_by_code, preview_file, delete_file, rename_file,
    download_folder, delete_folder, rename_folder
)

urlpatterns = [
    path('admin/', admin.site.urls),
    
    # === 檔案操作 (Files) ===
    path('download/<str:short_code>/', download_by_code, name='short_download'),
    path('preview/<str:short_code>/', preview_file, name='file_preview'),
    path('delete/<str:short_code>/', delete_file, name='delete_file'),
    path('rename_file/<str:short_code>/', rename_file, name='rename_file'),

    # === 資料夾操作 (Folders) ===
    path('download_folder/<int:folder_id>/', download_folder, name='download_folder'),
    path('delete_folder/<int:folder_id>/', delete_folder, name='delete_folder'),
    path('rename_folder/<int:folder_id>/', rename_folder, name='rename_folder'),

    # === 靜態與媒體檔案服務 (Production / Debug=False) ===
    # 注意：這些設定允許在沒有 Nginx 的情況下由 Django 直接服務檔案
    re_path(r'^media/(?P<path>.*)$', serve, {'document_root': settings.MEDIA_ROOT}),
    re_path(r'^static/(?P<path>.*)$', serve, {'document_root': settings.STATIC_ROOT}),

    # === 核心路徑解析 ===
    path('', path_resolver, {'resource_path': ''}, name='home'),
    path('<path:resource_path>/', path_resolver, name='resolve_path'),
]