import os
import json
import mimetypes
import zipfile
import io

from django.shortcuts import render, redirect, get_object_or_404, Http404
from django.http import FileResponse, HttpResponseNotFound, HttpResponse
from django.conf import settings
from django.core.files import File  # [新增] 用來包裝暫存檔
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
    try:
        # A. 搜尋
        search_query = request.GET.get('q')
        if search_query:
            context = {
                'search_query': search_query,
                'files': FileModel.objects.filter(file__icontains=search_query),
                'folders': Folder.objects.filter(name__icontains=search_query),
                'is_search': True,
            }
            return render(request, 'index.html', context)

        # B. 解析路徑
        parts = [p for p in resource_path.split('/') if p]
        current_folder = None
        breadcrumbs = []
        temp_path = ""
        
        for part in parts:
            try:
                current_folder = Folder.objects.get(parent=current_folder, name=part)
                temp_path = f"{temp_path}/{part}" if temp_path else part
                breadcrumbs.append({'name': part, 'path': temp_path})
            except Folder.DoesNotExist:
                if part == parts[-1]:
                    try:
                        target = FileModel.objects.get(folder=current_folder, file__icontains=part)
                        return redirect('short_download', short_code=target.short_code)
                    except FileModel.DoesNotExist:
                        pass
                raise Http404(f"Path not found: {part}")

        # C. 處理 POST
        if request.method == 'POST':
            action = request.POST.get('action')
            return handle_post_action(request, action, current_folder, resource_path)

        # D. 顯示資料
        folders = Folder.objects.filter(parent=current_folder)
        files = list(FileModel.objects.filter(folder=current_folder))

        # 排序
        sort_by = request.GET.get('sort', 'date')
        order = request.GET.get('order', 'desc')
        apply_sorting(folders, files, sort_by, order)
        
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
        print(f"[error] Path Resolver: {e}")
        return redirect('home')

# === 3. 輔助函數 (重構用) ===
def handle_post_action(request, action, current_folder, resource_path):
    try:
        # 1. 分片上傳 (只負責存碎片)
        if action == 'upload_chunk':
            file_chunk = request.FILES.get('file')
            upload_id = request.POST.get('upload_id')
            chunk_index = int(request.POST.get('chunk_index'))
            
            # 確保暫存目錄存在
            temp_dir = os.path.join(settings.MEDIA_ROOT, 'temp_chunks')
            if not os.path.exists(temp_dir):
                os.makedirs(temp_dir)
            
            # 存成獨立的小檔案：{upload_id}_{chunk_index}
            # 這樣並發寫入時才不會打架
            temp_file_path = os.path.join(temp_dir, f"{upload_id}_{chunk_index}")

            with open(temp_file_path, 'wb') as f:
                for chunk in file_chunk.chunks():
                    f.write(chunk)

            return HttpResponse("Chunk saved")

        # 2. 合併請求 (新功能：所有碎片傳完後觸發)
        elif action == 'complete_upload':
            upload_id = request.POST.get('upload_id')
            filename = request.POST.get('filename')
            total_chunks = int(request.POST.get('total_chunks'))
            
            temp_dir = os.path.join(settings.MEDIA_ROOT, 'temp_chunks')
            final_temp_path = os.path.join(temp_dir, f"{upload_id}_final")

            print(f"[info] Merging {total_chunks} chunks for {filename}...")

            # 開始合併
            with open(final_temp_path, 'wb') as final_file:
                for i in range(total_chunks):
                    chunk_path = os.path.join(temp_dir, f"{upload_id}_{i}")
                    if not os.path.exists(chunk_path):
                        raise Exception(f"Missing chunk {i}")
                    
                    # 讀取碎片寫入總檔
                    with open(chunk_path, 'rb') as chunk_file:
                        final_file.write(chunk_file.read())
                    
                    # 寫完立刻刪除碎片，釋放空間
                    os.remove(chunk_path)

            # 儲存到 Django FileModel
            with open(final_temp_path, 'rb') as f:
                django_file = File(f)
                new_file = FileModel(folder=current_folder)
                new_file.file.save(filename, django_file, save=True)
            
            # 刪除暫存總檔
            if os.path.exists(final_temp_path):
                os.remove(final_temp_path)

            return HttpResponse("Upload completed")

    except Exception as e:
        print(f"[error] POST action '{action}' failed: {e}")
        # 如果是分片上傳，回傳錯誤狀態碼讓前端知道
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