import os
from django.core.files.storage import FileSystemStorage
from django.conf import settings

class OverwriteStorage(FileSystemStorage):
    """
    自定義儲存系統：如果檔案已存在，刪除舊檔而不改名。
    """
    def get_available_name(self, name, max_length=None):
        full_path = os.path.join(settings.MEDIA_ROOT, name)
        if os.path.exists(full_path):
            os.remove(full_path)
        return name