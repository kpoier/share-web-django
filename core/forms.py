from django import forms
from .models import FileModel, Folder

class UploadForm(forms.ModelForm):
    class Meta:
        model = FileModel
        fields = ['file']

class FolderForm(forms.ModelForm):
    class Meta:
        model = Folder
        fields = ['name']
        widgets = {
            'name': forms.TextInput(attrs={'placeholder': 'Enter folder name...'})
        }
    
    def clean_name(self):
        name = self.cleaned_data['name']
        if '/' in name or '\\' in name:
            raise forms.ValidationError("Folder name cannot contain slashes.")
        return name