import os
import secrets
import string
from django.db import models
from django.dispatch import receiver
from .storage import OverwriteStorage

# 生成 4 位隨機代碼 (a-z, A-Z, 0-9)
def generate_short_code():
    chars = string.ascii_letters + string.digits
    while True:
        code = ''.join(secrets.choice(chars) for _ in range(4))
        # 確保代碼不重複
        if not FileModel.objects.filter(short_code=code).exists():
            return code

# === 動態路徑函數 ===
def folder_path_handler(instance, filename):
    """
    動態決定檔案路徑：
    如果有資料夾，存到 'files/folder_{id}/{filename}'
    如果是根目錄，存到 'files/root/{filename}'
    這樣不同資料夾的相同檔名就不會打架了。
    """
    # instance 是 FileModel 的實例
    if instance.folder:
        # 使用 folder.id 來做物理隔離，保證不同資料夾即使同名也不會衝突
        return f'files/folder_{instance.folder.id}/{filename}'
    else:
        return f'files/root/{filename}'

class Folder(models.Model):
    name = models.CharField(max_length=50, verbose_name="name")
    parent = models.ForeignKey('self', on_delete=models.CASCADE, null=True, blank=True, related_name='subfolders')

    # 遞迴計算完整路徑字串 (例如 "docs/work/project")
    def get_full_path(self):
        path_list = [self.name]
        current = self.parent
        while current:
            path_list.insert(0, current.name)
            current = current.parent
        return "/".join(path_list)
    
    def __str__(self):
        return self.name

class FileModel(models.Model):
    # === upload_to 改用上面的函數 ===
    file = models.FileField(
        upload_to=folder_path_handler,
        storage=OverwriteStorage()
    )
    
    folder = models.ForeignKey(Folder, on_delete=models.CASCADE, null=True, blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)
    short_code = models.CharField(max_length=10, unique=True, default=generate_short_code, editable=False)

    def filename(self):
        return os.path.basename(self.file.name)

    def save(self, *args, **kwargs):
        # 覆蓋邏輯 (資料庫層面的清理) 維持不變
        this_filename = self.file.name
        
        # 這裡會檢查「同一個資料夾」下有沒有同名的
        existing = FileModel.objects.filter(
            folder=self.folder, 
            file__endswith=this_filename 
        ).exclude(id=self.id)

        if existing.exists():
            existing.delete()
        
        super().save(*args, **kwargs)
    
    # 判斷是否為可預覽的格式
    def is_previewable(self):
        # 取出副檔名 (例如 .jpg, .pdf)
        ext = os.path.splitext(self.file.name)[1].lower()
        
        # 定義白名單：瀏覽器通常原生支援這些
        valid_extensions = [
            '.jpg', '.jpeg', '.png', '.gif', '.webp',
            '.pdf',
            '.txt', '.log', '.py', '.c', '.cpp',
            '.mp4', '.webm', '.mp3', '.wav'
        ]
        return ext in valid_extensions

    def __str__(self):
        return self.file.name