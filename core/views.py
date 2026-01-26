import os
import json
import mimetypes
import zipfile
import io
import uuid

from django.shortcuts import render, redirect, get_object_or_404, Http404
from django.http import FileResponse, HttpResponse, HttpResponseNotFound
from django.db.models import Q
from django.core.exceptions import ObjectDoesNotExist

from .models import FileModel, Folder
from .forms import UploadForm, FolderForm

# === 1. 檔案下載與預覽 ===

def download_by_code(request, short_code):
    """透過短網址下載檔案"""
    try:
        file_obj = get_object_or_404(FileModel, short_code=short_code)
        
        if not file_obj.file or not os.path.exists(file_obj.file.path):
            print(f"[error] Download failed: File {short_code} missing on disk.")
            raise Http404("File missing on server.")

        response = FileResponse(open(file_obj.file.path, 'rb'), as_attachment=True)
        response["Content-Disposition"] = f'attachment; filename="{os.path.basename(file_obj.file.name)}"'
        return response
    
    except Exception as e:
        print(f"[error] Download error: {e}")
        raise Http404("Download failed.")

def preview_file(request, short_code):
    """線上預覽檔案 (Inline)"""
    try:
        file_obj = get_object_or_404(FileModel, short_code=short_code)
        file_path = file_obj.file.path
        
        if not os.path.exists(file_path):
            raise Http404("File not found on disk")

        content_type, _ = mimetypes.guess_type(file_path)
        if not content_type:
            content_type = 'application/octet-stream'

        response = FileResponse(open(file_path, 'rb'), content_type=content_type)
        response["Content-Disposition"] = f'inline; filename="{os.path.basename(file_obj.file.name)}"'
        return response

    except Exception as e:
        print(f"[error] Preview error: {e}")
        return HttpResponseNotFound("Preview unavailable.")

# === 2. 核心路徑解析 (主頁面) ===

def path_resolver(request, resource_path):
    """
    處理首頁、資料夾瀏覽、搜尋以及檔案上傳邏輯。
    """
    try:
        # A. 搜尋模式
        search_query = request.GET.get('q')
        if search_query:
            context = {
                'search_query': search_query,
                'files': FileModel.objects.filter(file__icontains=search_query),
                'folders': Folder.objects.filter(name__icontains=search_query),
                'is_search': True,
            }
            return render(request, 'index.html', context)

        # B. 路徑解析與麵包屑
        parts = [p for p in resource_path.split('/') if p]
        current_folder = None
        breadcrumbs = []
        
        # 逐層解析路徑
        temp_path = ""
        for part in parts:
            try:
                current_folder = Folder.objects.get(parent=current_folder, name=part)
                temp_path = f"{temp_path}/{part}" if temp_path else part
                breadcrumbs.append({'name': part, 'path': temp_path})
            except Folder.DoesNotExist:
                # 若找不到資料夾，檢查是否為路徑最後一節的檔案 (用於短網址跳轉兼容)
                if part == parts[-1]:
                    try:
                        target = FileModel.objects.get(folder=current_folder, file__icontains=part)
                        return redirect('short_download', short_code=target.short_code)
                    except FileModel.DoesNotExist:
                        pass
                print(f"[error] Path not found: {part}")
                raise Http404(f"Folder or file '{part}' does not exist.")

        # C. 表單處理 (POST)
        if request.method == 'POST':
            action = request.POST.get('action')
            return handle_post_action(request, action, current_folder, resource_path)

        # D. 資料準備與排序
        folders = Folder.objects.filter(parent=current_folder)
        files = list(FileModel.objects.filter(folder=current_folder))

        # 排序邏輯
        sort_by = request.GET.get('sort', 'date')
        order = request.GET.get('order', 'desc')
        
        apply_sorting(folders, files, sort_by, order)

        # 下一次點擊的排序狀態
        next_order = lambda s: 'desc' if sort_by == s and order == 'asc' else 'asc'
        
        context = {
            'upload_form': UploadForm(),
            'folder_form': FolderForm(),
            'folders': folders,
            'files': files,
            'current_folder': current_folder,
            'current_path': resource_path,
            'breadcrumbs': breadcrumbs,
            'is_search': False,
            'sort_params': {
                'current_sort': sort_by,
                'current_order': order,
                'next_name_order': next_order('name'),
                'next_size_order': next_order('size'),
                'next_date_order': next_order('date'),
            },
        }
        return render(request, 'index.html', context)

    except Exception as e:
        print(f"[error] Path Resolver Crash: {e}")
        return redirect('home')

# === 3. 輔助函數 (重構用) ===

def handle_post_action(request, action, current_folder, resource_path):
    """處理上傳與建立資料夾的 POST 請求"""
    try:
        # === A. 處理分片上傳 (新功能) ===
        if action == 'upload_chunk':
            file_chunk = request.FILES.get('file')
            upload_id = request.POST.get('upload_id')      # 前端生成的唯一 ID
            chunk_index = int(request.POST.get('chunk_index')) # 第幾片 (0, 1, 2...)
            total_chunks = int(request.POST.get('total_chunks'))
            filename = request.POST.get('filename')
            
            # 建立暫存資料夾
            temp_dir = os.path.join(settings.MEDIA_ROOT, 'temp_chunks')
            if not os.path.exists(temp_dir):
                os.makedirs(temp_dir)
            
            # 暫存檔案路徑 (用 upload_id 區分不同檔案)
            temp_file_path = os.path.join(temp_dir, f"{upload_id}.part")

            # 1. 寫入碎片 (Append 模式)
            # 注意：這裡假設前端是「依序」發送 (0 -> 1 -> 2)，所以用 append ('ab')
            with open(temp_file_path, 'ab') as f:
                for chunk in file_chunk.chunks():
                    f.write(chunk)

            # 2. 如果是最後一片，進行收尾
            if chunk_index == total_chunks - 1:
                # 建立 DB 物件 (這會決定最終路徑)
                # 我們先建立一個「空」的 FileModel，讓 Django 幫我們算好路徑
                new_file = FileModel(folder=current_folder)
                new_file.file.save(filename, open(temp_file_path, 'rb'), save=True)
                
                # 刪除暫存檔
                os.remove(temp_file_path)
                print(f"[info] Chunked upload completed: {filename}")
                
            return HttpResponse("Chunk received") # 回傳簡單的成功訊息即可，不需要 redirect

        # === B. 一般上傳 (保留給不支援 JS 的環境，或是小檔備用) ===
        elif action == 'upload':
            files = request.FILES.getlist('file')
            for f in files:
                FileModel.objects.create(file=f, folder=current_folder)

        elif action == 'create_folder':
            form = FolderForm(request.POST)
            if form.is_valid():
                folder = form.save(commit=False)
                folder.parent = current_folder
                folder.save()

        elif action == 'upload_folder':
            files = request.FILES.getlist('folder_files')
            paths = json.loads(request.POST.get('paths', '[]'))
            if files and paths:
                for file_obj, rel_path in zip(files, paths):
                    # 解析路徑結構: "A/B/file.txt" -> create folders A, B -> save file
                    path_parts = rel_path.split('/')
                    target_folder = current_folder
                    for folder_name in path_parts[:-1]:
                        target_folder, _ = Folder.objects.get_or_create(
                            parent=target_folder, name=folder_name
                        )
                    FileModel.objects.create(file=file_obj, folder=target_folder)

    except Exception as e:
        print(f"[error] POST action '{action}' failed: {e}")
        # 如果是分片上傳失敗，回傳 500 讓前端知道要重試
        if action == 'upload_chunk':
             return HttpResponse(str(e), status=500)

    return redirect('resolve_path', resource_path=resource_path) if resource_path else redirect('home')

def apply_sorting(folders, files, sort_by, order):
    """對列表進行排序 (In-place)"""
    reverse = (order == 'desc')
    try:
        if sort_by == 'name':
            key = lambda x: x.name.lower() if hasattr(x, 'name') else x.filename().lower()
            folders[:] = sorted(folders, key=lambda x: x.name.lower(), reverse=reverse)
            files.sort(key=lambda x: x.filename().lower(), reverse=reverse)
        elif sort_by == 'size':
            # 資料夾不排大小，只排檔案
            def get_size(x):
                try: return x.file.size
                except: return 0
            files.sort(key=get_size, reverse=reverse)
        else: # date
            # 資料夾沒時間，不變動或按 ID 排
            files.sort(key=lambda x: x.uploaded_at, reverse=reverse)
    except Exception as e:
        print(f"[error] Sorting failed: {e}")

# === 4. 資料夾操作 ===

def download_folder(request, folder_id):
    try:
        folder = get_object_or_404(Folder, id=folder_id)
        buffer = io.BytesIO()
        
        with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
            def add_recursive(curr_folder, rel_path):
                # 加入檔案
                for f in curr_folder.filemodel_set.all():
                    if f.file and os.path.exists(f.file.path):
                        zf.write(f.file.path, os.path.join(rel_path, f.filename()))
                # 加入子資料夾
                for sub in curr_folder.subfolders.all():
                    add_recursive(sub, os.path.join(rel_path, sub.name))

            add_recursive(folder, folder.name)

        buffer.seek(0)
        return FileResponse(buffer, as_attachment=True, filename=f'{folder.name}.zip')
    except Exception as e:
        print(f"[error] Zip folder failed: {e}")
        return redirect(request.META.get('HTTP_REFERER', 'home'))

def delete_folder(request, folder_id):
    if request.method == 'POST':
        try:
            folder = Folder.objects.get(id=folder_id)
            # 遞迴刪除實體檔案
            def delete_files_recursive(curr_folder):
                for f in curr_folder.filemodel_set.all():
                    if f.file and os.path.exists(f.file.path):
                        try: os.remove(f.file.path)
                        except OSError: pass
                for sub in curr_folder.subfolders.all():
                    delete_files_recursive(sub)
            
            delete_files_recursive(folder)
            folder.delete()
            print(f"[info] Folder {folder_id} deleted.")
        except Folder.DoesNotExist:
            print(f"[info] Folder {folder_id} already deleted.")
        except Exception as e:
            print(f"[error] Delete folder error: {e}")

    return redirect(request.META.get('HTTP_REFERER', 'home'))

def rename_folder(request, folder_id):
    try:
        if request.method == 'POST':
            folder = get_object_or_404(Folder, id=folder_id)
            new_name = request.POST.get('new_name')
            if new_name and '/' not in new_name:
                folder.name = new_name
                folder.save()
    except Exception as e:
        print(f"[error] Rename folder error: {e}")
    return redirect(request.META.get('HTTP_REFERER', 'home'))

# === 5. 檔案操作 ===

def delete_file(request, short_code):
    if request.method == 'POST':
        try:
            file_obj = FileModel.objects.get(short_code=short_code)
            if file_obj.file and os.path.exists(file_obj.file.path):
                try: os.remove(file_obj.file.path)
                except OSError: pass
            file_obj.delete()
            print(f"[info] File {short_code} deleted.")
        except FileModel.DoesNotExist:
            print(f"[info] File {short_code} already deleted.")
        except Exception as e:
            print(f"[error] Delete file error: {e}")
    return redirect(request.META.get('HTTP_REFERER', 'home'))

def rename_file(request, short_code):
    try:
        if request.method == 'POST':
            file_obj = get_object_or_404(FileModel, short_code=short_code)
            new_name = request.POST.get('new_name')
            
            if new_name and '/' not in new_name and '\\' not in new_name:
                old_path = file_obj.file.path
                dir_name = os.path.dirname(old_path)
                new_path = os.path.join(dir_name, new_name)
                
                if old_path != new_path and not os.path.exists(new_path):
                    os.rename(old_path, new_path)
                    # 更新資料庫路徑 (保持相對路徑結構)
                    old_rel = file_obj.file.name
                    new_rel = os.path.join(os.path.dirname(old_rel), new_name).replace('\\', '/')
                    file_obj.file.name = new_rel
                    file_obj.save()
    except Exception as e:
        print(f"[error] Rename file error: {e}")
    return redirect(request.META.get('HTTP_REFERER', 'home'))