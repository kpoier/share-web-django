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
    
    // [設定] 分片大小：50MB (Cloudflare 限制 100MB，留點緩衝)
    CHUNK_SIZE: 50 * 1024 * 1024, 

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
            // 處理資料夾上傳的路徑邏輯 (暫時不支援資料夾結構的分片上傳，這裡簡化為純檔案上傳)
            // 如果要支援資料夾結構，後端 upload_chunk 邏輯會變得很複雜
            // 這裡我們假設資料夾上傳時，裡面的檔案也走分片邏輯，但不帶目錄結構參數 (或是你需要後端再支援)
            
            // 產生一個唯一的 upload_id 給後端組裝用
            const uploadUUID = crypto.randomUUID();

            const item = { 
                id, file, action, path: pathToSend, 
                loaded: 0, total: file.size, xhr: null, status: 'pending', ui: null,
                uploadUUID: uploadUUID
            };
            
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

    // [核心修改] 改為分片上傳邏輯
    async startUpload(item) {
        item.status = 'uploading';
        this.activeUploads++;
        
        const totalChunks = Math.ceil(item.file.size / this.CHUNK_SIZE);
        const csrfToken = document.querySelector('input[name="csrfmiddlewaretoken"]').value;
        
        // 併發控制：同時允許幾個請求 (建議 3-5，過多會讓瀏覽器卡頓)
        const MAX_CONCURRENT_CHUNKS = 3;
        
        let activeRequests = 0;
        let nextChunkIndex = 0;
        let isAborted = false;

        // 定義單一碎片上傳函數 (回傳 Promise)
        const uploadChunk = (index) => {
            return new Promise((resolve, reject) => {
                if (item.status === 'cancelled' || isAborted) {
                    reject('cancelled');
                    return;
                }

                const start = index * this.CHUNK_SIZE;
                const end = Math.min(start + this.CHUNK_SIZE, item.file.size);
                const chunk = item.file.slice(start, end);

                const formData = new FormData();
                formData.append('csrfmiddlewaretoken', csrfToken);
                formData.append('action', 'upload_chunk');
                formData.append('file', chunk);
                formData.append('upload_id', item.uploadUUID);
                formData.append('chunk_index', index);

                const xhr = new XMLHttpRequest();
                // 這裡我們不把 xhr 存到 item.xhr 了，因為有多個並發
                // 如果需要取消，比較複雜，這裡簡化處理：設一個 flag 讓後續請求不發送
                
                xhr.open('POST', window.location.href, true);

                // 監聽進度：只計算「已完成」的量，或者簡單估算
                // 因為並發時計算精確進度比較複雜，我們這裡用「完成一片加一片」的方式更新
                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 400) {
                        // 更新進度條
                        const loadedSize = (index + 1) * this.CHUNK_SIZE;
                        item.loaded = Math.min(loadedSize, item.file.size);
                        this.updateItemUI(item);
                        this.updateUI();
                        resolve();
                    } else {
                        reject('error');
                    }
                };
                
                xhr.onerror = () => reject('error');
                xhr.send(formData);
            });
        };

        // 併發執行器
        try {
            const promises = [];
            
            // 迴圈直到所有碎片都進入排程
            while (nextChunkIndex < totalChunks) {
                // 如果正在跑的請求少於上限，就塞新的進去
                if (activeRequests < MAX_CONCURRENT_CHUNKS) {
                    const currentIndex = nextChunkIndex++;
                    activeRequests++;
                    
                    const p = uploadChunk(currentIndex).then(() => {
                        activeRequests--;
                    });
                    promises.push(p);
                }
                
                // 等待一下，讓事件迴圈處理 (避免卡死 UI)
                if (activeRequests >= MAX_CONCURRENT_CHUNKS) {
                    // 簡單等待：每 100ms 檢查一次是否有空位 (或是用更高級的 Promise.race)
                    await new Promise(r => setTimeout(r, 50));
                }
            }
            
            // 等待所有碎片傳完
            await Promise.all(promises);

            // === 所有碎片都傳完了，發送合併請求 ===
            if (item.status !== 'cancelled') {
                const formData = new FormData();
                formData.append('csrfmiddlewaretoken', csrfToken);
                formData.append('action', 'complete_upload');
                formData.append('upload_id', item.uploadUUID);
                formData.append('filename', item.file.name);
                formData.append('total_chunks', totalChunks);

                const xhr = new XMLHttpRequest();
                xhr.open('POST', window.location.href, true);
                xhr.onload = () => {
                    if (xhr.status === 200) {
                        this.finishUpload(item, 'completed');
                    } else {
                        this.finishUpload(item, 'error');
                    }
                };
                xhr.send(formData);
            }

        } catch (error) {
            if (error !== 'cancelled') {
                this.finishUpload(item, 'error');
            }
        }
    },

    finishUpload(item, status) {
        this.activeUploads--;
        item.status = status;
        if (status === 'error') this.hasError = true;
        
        // 確保進度條跑滿
        if (status === 'completed') item.loaded = item.total;
        
        this.updateItemUI(item);
        this.updateUI();
        this.processQueue();
        this.checkFinished();
    },

    cancel(id) {
        const item = this.queue.find(i => i.id === id);
        if (!item) return;

        if (item.status === 'uploading' && item.xhr) {
            item.xhr.abort();
            this.activeUploads--;
        }

        item.status = 'cancelled';
        
        if (item.ui) {
            item.ui.remove();
        }

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