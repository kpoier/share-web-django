// === 1. Utilities ===
const handleRowClick = (url) => { if (url) window.location.href = url; };
const stopProp = (e) => e.stopPropagation();

function createFolderPopup() {
    const name = prompt("Please enter new folder name:");
    if (name?.trim()) {
        document.getElementById('hidden-folder-name').value = name;
        document.getElementById('folder-form').submit();
    }
}

function renameItem(e, url, oldName) {
    e.stopPropagation();
    const newName = prompt("Enter new name:", oldName);
    if (newName?.trim() && newName !== oldName) {
        submitHiddenForm(url, { new_name: newName });
    }
}

function deleteItem(e, url, itemName) {
    e.stopPropagation();
    if (e.shiftKey || confirm(`Are you sure you want to delete "${itemName}"?`)) {
        submitHiddenForm(url, {});
    }
}

// Helper to create and submit a form dynamically
function submitHiddenForm(url, data) {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = url;
    
    const csrf = document.querySelector('input[name="csrfmiddlewaretoken"]').value;
    form.appendChild(createHiddenInput("csrfmiddlewaretoken", csrf));
    
    Object.keys(data).forEach(key => {
        form.appendChild(createHiddenInput(key, data[key]));
    });
    
    document.body.appendChild(form);
    form.submit();
}

function createHiddenInput(name, value) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    return input;
}

function toggleUploadDetails() {
    const panel = document.getElementById('upload-details-panel');
    const icon = document.querySelector('#btn-toggle-details i');
    const isHidden = panel.style.display === 'none';
    panel.style.display = isHidden ? 'block' : 'none';
    icon.className = isHidden ? 'bi bi-chevron-up' : 'bi bi-chevron-down';
}

// === 2. Upload Manager ===
const UploadManager = {
    queue: [], activeUploads: 0, maxConcurrent: 3, isUploading: false, hasError: false,

    initUI() {
        document.getElementById('upload-progress-card').style.display = 'block';
        document.getElementById('upload-details-panel').style.display = 'block';
        document.querySelector('#btn-toggle-details i').className = 'bi bi-chevron-up';
        document.getElementById('btn-close-card').style.display = 'none';
        this.hasError = false;
        this.updateUI();
    },

    closeCard() {
        document.getElementById('upload-progress-card').style.display = 'none';
        // Only reload if everything is done
        if (this.queue.every(i => ['completed', 'error', 'cancelled'].includes(i.status))) {
             window.location.reload();
        }
    },

    addFiles(fileList, action, isFolder = false, customPaths = null) {
        if (!this.isUploading) { this.initUI(); this.isUploading = true; }
        
        const listContainer = document.getElementById('upload-file-list');
        Array.from(fileList).forEach((file, i) => {
            const id = 'upload-' + Math.random().toString(36).substr(2, 9);
            let pathToSend = null;
            if (customPaths?.[i]) pathToSend = JSON.stringify([customPaths[i]]);
            else if (isFolder) pathToSend = JSON.stringify([file.webkitRelativePath]);

            const item = { id, file, action, path: pathToSend, loaded: 0, total: file.size, xhr: null, status: 'pending', ui: null };
            
            const li = document.createElement('li');
            li.className = 'upload-item';
            li.id = id;
            li.innerHTML = `
                <div class="d-flex justify-content-between align-items-center" style="position:relative; z-index:2;">
                    <div class="d-flex align-items-center gap-2" style="overflow: hidden;">
                        <i class="bi bi-file-earmark text-secondary"></i>
                        <span class="text-truncate item-name" style="max-width: 180px; font-size: 0.85rem;">${file.name}</span>
                    </div>
                    <div class="d-flex align-items-center gap-2">
                        <span class="text-muted item-percent" style="font-size: 0.75rem;">0%</span>
                        <button class="btn-cancel-upload" onclick="UploadManager.cancel('${id}')"><i class="bi bi-x"></i></button>
                    </div>
                </div>
                <div class="upload-item-progress-bg"><div class="upload-item-progress-bar" style="width: 0%"></div></div>`;
            
            listContainer.appendChild(li);
            item.ui = li;
            this.queue.push(item);
        });
        this.processQueue();
    },

    processQueue() {
        while (this.activeUploads < this.maxConcurrent) {
            const next = this.queue.find(item => item.status === 'pending');
            if (!next) break;
            this.startUpload(next);
        }
    },

    startUpload(item) {
        item.status = 'uploading';
        this.activeUploads++;
        
        const formData = new FormData();
        formData.append('csrfmiddlewaretoken', document.querySelector('input[name="csrfmiddlewaretoken"]').value);
        formData.append('action', item.action);
        
        if (item.action === 'upload_folder') {
            formData.append('folder_files', item.file);
            formData.append('paths', item.path);
        } else {
            formData.append('file', item.file);
        }

        const xhr = new XMLHttpRequest();
        item.xhr = xhr;
        xhr.open('POST', window.location.href, true);

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                item.loaded = e.loaded;
                this.updateItemUI(item);
                this.updateUI();
            }
        };

        const onFinish = (status) => {
            this.activeUploads--;
            item.status = status;
            if (status === 'error') this.hasError = true;
            this.updateItemUI(item);
            this.updateUI();
            this.processQueue();
            this.checkFinished();
        };

        xhr.onload = () => onFinish(xhr.status >= 200 && xhr.status < 400 ? 'completed' : 'error');
        xhr.onerror = () => onFinish('error');
        xhr.send(formData);
    },

    cancel(id) {
        const item = this.queue.find(i => i.id === id);
        if (!item) return;
        if (item.status === 'uploading' && item.xhr) {
            item.xhr.abort();
            this.activeUploads--;
        }
        item.status = 'cancelled';
        item.ui.classList.add('cancelled');
        this.updateUI();
        this.processQueue();
        this.checkFinished();
    },

    updateItemUI(item) {
        const percent = Math.round((item.loaded / item.total) * 100);
        item.ui.querySelector('.upload-item-progress-bar').style.width = percent + '%';
        const percentText = item.ui.querySelector('.item-percent');
        
        if (item.status === 'completed') {
            item.ui.classList.add('completed');
            item.ui.querySelector('.bi-file-earmark').className = 'bi bi-check-circle-fill text-success';
            item.ui.querySelector('.upload-item-progress-bar').className += ' bg-success';
            percentText.innerText = 'Done';
            item.ui.querySelector('.btn-cancel-upload')?.remove();
        } else if (item.status === 'error') {
            item.ui.querySelector('.bi-file-earmark').className = 'bi bi-exclamation-circle-fill text-danger';
            item.ui.querySelector('.upload-item-progress-bar').className += ' bg-danger';
            percentText.innerText = 'Error';
        } else {
            percentText.innerText = percent + '%';
        }
    },

    updateUI() {
        const loaded = this.queue.reduce((acc, i) => acc + (i.status !== 'cancelled' ? i.loaded : 0), 0);
        const total = this.queue.reduce((acc, i) => acc + (i.status !== 'cancelled' ? i.total : 0), 0) || 1;
        const percent = Math.round((loaded / total) * 100);
        
        document.getElementById('progress-bar-inner').style.width = percent + '%';
        document.getElementById('progress-percent').innerText = percent + '%';
        document.getElementById('progress-status').innerText = 
            `${(loaded / 1024 / 1024).toFixed(2)} MB / ${(total / 1024 / 1024).toFixed(2)} MB`;
    },

    checkFinished() {
        if (!this.queue.some(i => i.status === 'pending') && this.activeUploads === 0) {
            const statusText = document.getElementById('progress-status');
            if (this.hasError) {
                statusText.innerHTML = '<span class="text-danger">Completed with errors.</span>';
                document.getElementById('progress-bar-inner').className = 'progress-bar bg-warning';
                document.getElementById('btn-close-card').style.display = 'flex';
            } else {
                statusText.innerText = 'All finished! Reloading...';
                setTimeout(() => window.location.reload(), 2000);
            }
        }
    }
};

// === 3. Drag & Drop Logic (Recursive) ===
(function() {
    if (('ontouchstart' in window) || (navigator.maxTouchPoints > 0)) return; // No drag on mobile

    const overlay = document.getElementById('drag-overlay');
    let dragCounter = 0;

    const traverse = (entry, path = "") => new Promise(resolve => {
        if (entry.isFile) {
            entry.file(file => resolve([{ file, path: path + file.name }]));
        } else if (entry.isDirectory) {
            const reader = entry.createReader();
            let entries = [];
            const read = () => {
                reader.readEntries(results => {
                    if (results.length) { entries.push(...results); read(); }
                    else Promise.all(entries.map(e => traverse(e, path + entry.name + "/")))
                        .then(r => resolve(r.flat()));
                });
            };
            read();
        }
    });

    window.addEventListener('dragenter', e => { e.preventDefault(); if (++dragCounter === 1) overlay.style.display = 'flex'; });
    window.addEventListener('dragleave', e => { if (--dragCounter === 0) overlay.style.display = 'none'; });
    window.addEventListener('dragover', e => e.preventDefault());
    window.addEventListener('drop', e => {
        e.preventDefault(); dragCounter = 0; overlay.style.display = 'none';
        const items = Array.from(e.dataTransfer.items).map(i => i.webkitGetAsEntry()).filter(i => i);
        Promise.all(items.map(i => traverse(i))).then(results => {
            const flat = results.flat();
            if (flat.length) {
                const hasFolder = flat.some(f => f.path.includes('/'));
                UploadManager.addFiles(flat.map(f => f.file), hasFolder ? 'upload_folder' : 'upload', hasFolder, flat.map(f => f.path));
            }
        });
    });
})();

// === 4. Bindings ===
function handleFileUpload() {
    const input = document.getElementById('hidden-file-input');
    if (input.files.length) { UploadManager.addFiles(input.files, 'upload'); input.value = ''; }
}
function handleFolderUpload() {
    const input = document.getElementById('hidden-folder-input');
    if (input.files.length) { UploadManager.addFiles(input.files, 'upload_folder', true); input.value = ''; }
}