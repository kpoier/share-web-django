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
    
    // [設定] 分片大小：50MB
    CHUNK_SIZE: 50 * 1024 * 1024, 

    initUI() {
        document.getElementById('upload-progress-card').style.display = 'block';
        document.getElementById('upload-details-panel').style.display = 'block';
        document.querySelector('#btn-toggle-details i').className = 'bi bi-chevron-up';
        document.getElementById('btn-close-card').style.display = 'none';
        
        // 重置狀態
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
            if (customPaths?.[i]) pathToSend = JSON.stringify([customPaths[i]]);
            else if (isFolder) pathToSend = JSON.stringify([file.webkitRelativePath]);

            const uploadUUID = crypto.randomUUID();
            
            const item = { 
                id, file, action, path: pathToSend, 
                loaded: 0, total: file.size, xhr: null, status: 'pending', ui: null,
                uploadUUID: uploadUUID,
                chunkProgress: [] 
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
        
        this.updateUI(); 
        this.processQueue();
    },

    processQueue() {
        while (this.activeUploads < this.maxConcurrent) {
            const next = this.queue.find(item => item.status === 'pending');
            if (!next) break;
            this.startUpload(next);
        }
    },

    // [核心] 分片並發上傳邏輯
    async startUpload(item) {
        item.status = 'uploading';
        this.activeUploads++;
        
        const totalChunks = Math.ceil(item.file.size / this.CHUNK_SIZE);
        item.chunkProgress = new Array(totalChunks).fill(0);
        
        const csrfToken = document.querySelector('input[name="csrfmiddlewaretoken"]').value;
        const MAX_CONCURRENT_CHUNKS = 3;
        
        let activeRequests = 0;
        let nextChunkIndex = 0;
        let isAborted = false;

        const uploadChunk = (index) => {
            return new Promise((resolve, reject) => {
                // 如果已經取消，直接 reject
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
                if (item.path) formData.append('paths', item.path);

                const xhr = new XMLHttpRequest();
                xhr.open('POST', window.location.href, true);

                xhr.upload.onprogress = (e) => {
                    if (e.lengthComputable) {
                        item.chunkProgress[index] = e.loaded;
                        const totalLoaded = item.chunkProgress.reduce((acc, val) => acc + val, 0);
                        item.loaded = Math.min(totalLoaded, item.file.size);
                        this.updateItemUI(item);
                        this.updateUI();
                    }
                };

                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 400) {
                        item.chunkProgress[index] = chunk.size; 
                        const totalLoaded = item.chunkProgress.reduce((acc, val) => acc + val, 0);
                        item.loaded = Math.min(totalLoaded, item.file.size);
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

        try {
            const promises = [];
            while (nextChunkIndex < totalChunks) {
                // 檢查是否已取消 (避免繼續發送請求)
                if (item.status === 'cancelled') { isAborted = true; break; }

                if (activeRequests < MAX_CONCURRENT_CHUNKS) {
                    const currentIndex = nextChunkIndex++;
                    activeRequests++;
                    const p = uploadChunk(currentIndex)
                        .then(() => { activeRequests--; })
                        .catch((err) => { activeRequests--; throw err; }); // 失敗時也要扣除
                    promises.push(p);
                }
                if (activeRequests >= MAX_CONCURRENT_CHUNKS) {
                    await new Promise(r => setTimeout(r, 50));
                }
            }
            
            await Promise.all(promises);

            // 合併請求 (只有在沒被取消的情況下)
            if (item.status !== 'cancelled') {
                const formData = new FormData();
                formData.append('csrfmiddlewaretoken', csrfToken);
                formData.append('action', 'complete_upload');
                formData.append('upload_id', item.uploadUUID);
                formData.append('filename', item.file.name);
                formData.append('total_chunks', totalChunks);
                if (item.action === 'upload_folder' && item.path) {
                    formData.append('paths', item.path);
                    formData.append('is_folder', 'true');
                }

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
            // 如果是因為取消而拋出的錯誤，我們不做任何事 (因為 cancel() 函數已經處理了)
            if (error !== 'cancelled' && item.status !== 'cancelled') {
                this.finishUpload(item, 'error');
            }
        }
    },

    // [修復] 增加防止重複執行的判斷
    finishUpload(item, status) {
        // 如果已經被標記為取消，就不再執行完成邏輯，避免 activeUploads 被扣兩次
        if (item.status === 'cancelled') return;

        this.activeUploads--;
        item.status = status;
        if (status === 'error') this.hasError = true;
        
        if (status === 'completed') {
            item.loaded = item.total;
        }
        
        this.updateItemUI(item);
        this.updateUI();
        this.processQueue();
        this.checkAllFinished();
    },

    // [核心修復] 這裡修正了 activeUploads 計數錯誤的問題
    cancel(id) {
        const item = this.queue.find(i => i.id === id);
        if (!item) return;

        // 只要是正在上傳中，就必須扣除計數器 (不管有沒有 xhr)
        if (item.status === 'uploading') {
            this.activeUploads--;
            // 注意：我們不需要手動 abort，因為 startUpload 裡的邏輯會檢測到 status 變更而停止
        }

        item.status = 'cancelled';
        item.loaded = 0; 
        
        // 視覺移除動畫
        if (item.ui) {
            item.ui.style.transition = "all 0.3s ease";
            item.ui.style.opacity = "0";
            item.ui.style.height = "0";
            item.ui.style.margin = "0";
            item.ui.style.padding = "0";
            item.ui.style.border = "none"; 
            setTimeout(() => {
                if(item.ui) item.ui.remove();
            }, 300);
        }

        this.updateUI();
        this.processQueue();
        this.checkAllFinished();
    },

    updateItemUI(item) {
        const percent = Math.round((item.loaded / item.total) * 100);
        if (item.ui) {
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
        }
    },

    updateUI() {
        let totalBytes = 0;
        let loadedBytes = 0;

        this.queue.forEach(item => {
            if (item.status !== 'cancelled') {
                totalBytes += item.total;
                loadedBytes += item.loaded;
            }
        });

        if (totalBytes === 0) {
            document.getElementById('progress-bar-inner').style.width = '0%';
            document.getElementById('progress-percent').innerText = '0%';
            document.getElementById('progress-status').innerText = '0.00 MB / 0.00 MB';
            return;
        }
        
        const percent = Math.round((loadedBytes / totalBytes) * 100);
        document.getElementById('progress-bar-inner').style.width = percent + '%';
        document.getElementById('progress-percent').innerText = percent + '%';
        
        const loadedMB = (loadedBytes / 1024 / 1024).toFixed(2);
        const totalMB = (totalBytes / 1024 / 1024).toFixed(2);
        document.getElementById('progress-status').innerText = 
            `${loadedMB} MB / ${totalMB} MB`;
    },

    checkAllFinished: function() {
        const isProcessing = this.queue.some(i => i.status === 'pending' || i.status === 'uploading');

        // [關鍵] 當沒有任何處理中的任務，且 activeUploads 確實歸零
        if (!isProcessing && this.activeUploads === 0) {
            const statusText = document.getElementById('progress-status');
            const hasCompletedOrError = this.queue.some(i => i.status === 'completed' || i.status === 'error');

            if (hasCompletedOrError) {
                if (this.hasError) {
                    statusText.innerHTML = '<span class="text-danger">Completed with errors.</span>';
                    document.getElementById('progress-bar-inner').className = 'progress-bar bg-warning';
                    document.getElementById('btn-close-card').style.display = 'flex';
                } else {
                    statusText.innerText = 'All finished! Reloading...';
                    setTimeout(() => { window.location.reload(); }, 2000);
                }
            } else {
                statusText.innerText = 'All cancelled. Closing...';
                setTimeout(() => {
                    const card = document.getElementById('upload-progress-card');
                    card.style.opacity = '0';
                    setTimeout(() => {
                        card.style.display = 'none';
                        card.style.opacity = '1';
                        this.queue = [];
                        this.hasError = false;
                        document.getElementById('upload-file-list').innerHTML = '';
                    }, 500);
                }, 1500);
            }
        }
    }
};

// === 3. Drag & Drop Logic ===
(function() {
    const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    if (isTouchDevice) return;

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