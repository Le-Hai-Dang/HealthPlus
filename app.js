let peer = null;
let currentCall = null;
let localStream = null;
let isCameraOn = true;
let isMicOn = true;
let waitingQueue = [];
let currentUserId = null;

// Thêm biến để lưu trữ thông tin admin
const ADMIN_CREDENTIALS = {
    username: 'admin',
    password: '123456',
    peerId: 'doctor123'
};

let isAdmin = false;
let adminPeerId = null;

// Thêm các STUN/TURN servers bổ sung
const ICE_SERVERS = {
    'iceServers': [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        {
            urls: 'turn:a.relay.metered.ca:443',
            username: 'e8c7e8e14b95e7e12d6f7592',
            credential: 'UAK0JrYJxNgA5cZe'
        }
    ],
    iceCandidatePoolSize: 10
};

// Cấu hình audio thống nhất
const AUDIO_CONFIG = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    sampleRate: 44100,
    channelCount: 1,
    latency: 0,
    volume: 1.0
};

async function initializePeer() {
    console.log("[DEBUG] Bắt đầu khởi tạo peer...");
    console.log("[DEBUG] isAdmin:", isAdmin);
    
    if (peer && !peer.destroyed) {
        console.log("[DEBUG] Hủy peer cũ");
        peer.destroy();
    }
    
    const peerConfig = {
        host: '0.peerjs.com',
        port: 443,
        secure: true,
        path: '/',
        debug: 3,
        config: ICE_SERVERS
    };

    try {
        // Tạo peer mới với ID cố định cho admin
        if (isAdmin) {
            console.log("[DEBUG] Tạo peer cho admin với ID: doctor123");
            peer = new Peer('doctor123', peerConfig);
        } else {
            console.log("[DEBUG] Tạo peer cho user thường");
            peer = new Peer(peerConfig);
        }

        peer.on('open', (id) => {
            console.log('[DEBUG] Peer mở kết nối thành công với ID:', id);
            console.log('[DEBUG] Trạng thái kết nối:', peer.connected);
            if (isAdmin) {
                console.log('[DEBUG] Cập nhật admin ID');
                adminPeerId = id;
                const adminIdElement = document.getElementById('admin-id');
                if (adminIdElement) {
                    adminIdElement.textContent = id;
                }
            }
        });

        peer.on('error', (error) => {
            console.error('[DEBUG] Lỗi PeerJS:', error.type);
            console.error('[DEBUG] Chi tiết lỗi:', error);
        });

        peer.on('disconnected', () => {
            console.log('[DEBUG] Peer bị ngắt kết nối');
            console.log('[DEBUG] Trạng thái destroyed:', peer.destroyed);
            console.log('[DEBUG] Trạng thái disconnected:', peer.disconnected);
        });

        peer.on('connection', (conn) => {
            console.log('[DEBUG] Có kết nối mới từ:', conn.peer);
        });

        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                console.log('[DEBUG] Timeout kết nối, kiểm tra trạng thái');
                console.log('[DEBUG] Peer connected:', peer.connected);
                console.log('[DEBUG] Peer disconnected:', peer.disconnected);
                resolve();
            }, 5000);

            peer.on('open', () => {
                console.log('[DEBUG] Kết nối thành công trong timeout');
                clearTimeout(timeout);
                resolve();
            });
        });

    } catch (err) {
        console.error('[DEBUG] Lỗi trong initializePeer:', err);
        throw err;
    }
}

async function connectToPeer(peerId) {
    try {
        // Kiểm tra thiết bị âm thanh
        const hasAudioDevice = await checkAudioDevices();
        if (!hasAudioDevice) {
            throw new Error('Vui lòng kết nối microphone để thực hiện cuộc gọi');
        }

        if (!peer || peer.destroyed) {
            await initializePeer();
        }

        // Khởi tạo stream mới nếu chưa có
        if (!localStream) {
            localStream = await initializeStream();
        }

        console.log('Bắt đầu gọi tới:', peerId);
        const call = peer.call(peerId, localStream);
        
        call.on('stream', (remoteStream) => {
            console.log('Nhận được remote stream');
            handleRemoteAudioOnly(remoteStream, peerId);
        });

        currentCall = call;

    } catch (err) {
        console.error('Lỗi kết nối:', err);
        alert(err.message);
    }
}

function handleCall(call) {
    currentCall = call;
    
    call.on('stream', async (remoteStream) => {
        console.log('Nhận được remote stream');
        try {
            // Khởi tạo local stream cho admin nếu chưa có
            if (isAdmin && !localStream) {
                localStream = await initializeStream();
                call.answer(localStream);
            }
            
            // Xử lý remote audio
            handleRemoteAudioOnly(remoteStream, call.peer);
            
            // Cập nhật UI
            document.getElementById('setup-box').classList.add('hidden');
            document.getElementById('call-box').classList.remove('hidden');
            updateControlButtons();

        } catch (err) {
            console.error('Lỗi xử lý remote stream:', err);
        }
    });

    // Xử lý lỗi cuộc gọi
    call.on('error', (err) => {
        console.error('Lỗi cuộc gọi:', err);
        endCall();
    });
}

function toggleCamera() {
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        isCameraOn = !isCameraOn;
        videoTrack.enabled = isCameraOn;
        document.getElementById('camera-btn').textContent = 
            isCameraOn ? 'Tắt Camera' : 'Bật Camera';
    }
}

function toggleMic() {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        isMicOn = !isMicOn;
        audioTrack.enabled = isMicOn;
        document.getElementById('mic-btn').textContent = 
            isMicOn ? 'Tắt Mic' : 'Bật Mic';
    }
}

function endCall() {
    try {
        if (currentCall) {
            currentCall.close();
        }
        
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }

        currentCall = null;
        updateCallUI(false);

        if (isAdmin) {
            initializeStream().then(stream => {
                localStream = stream;
            }).catch(console.error);
        }
    } catch (err) {
        console.error('[DEBUG] Lỗi khi kết thúc cuộc gọi:', err);
    }
}

// Thêm hàm toggleLoginForm
function toggleLoginForm() {
    const loginBox = document.getElementById('login-box');
    
    if (loginBox.classList.contains('hidden')) {
        // Hiện form login và thêm overlay
        loginBox.classList.remove('hidden');
        if (!document.querySelector('.overlay')) {
            document.body.insertAdjacentHTML('beforeend', '<div class="overlay"></div>');
            document.querySelector('.overlay').addEventListener('click', toggleLoginForm);
        }
    } else {
        // Ẩn form login và xóa overlay
        loginBox.classList.add('hidden');
        const overlay = document.querySelector('.overlay');
        if (overlay) {
            overlay.remove();
        }
    }
}

// Sửa lại hàm login
function login() {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    if (username === ADMIN_CREDENTIALS.username && password === ADMIN_CREDENTIALS.password) {
        isAdmin = true;
        toggleLoginForm(); // Ẩn form login
        document.getElementById('setup-box').classList.remove('hidden');
        document.querySelector('#setup-box h2').textContent = 'Chào mừng Bác sĩ';
        document.getElementById('login-button').textContent = 'Bác sĩ đã đăng nhập';
        document.getElementById('login-button').disabled = true;
        // Ẩn nút kết nối với bác sĩ
        document.getElementById('quick-connect').classList.add('hidden');
        initializePeer();
    } else if (username && password) {
        isAdmin = false;
        toggleLoginForm(); // Ẩn form login
        document.getElementById('setup-box').classList.remove('hidden');
        document.querySelector('#setup-box h2').textContent = 'Kết nối với Bác sĩ';
        document.getElementById('login-button').textContent = 'Đã đăng nhập';
        document.getElementById('login-button').disabled = true;
        // Hiển thị nút kết nối với bác sĩ
        document.getElementById('quick-connect').classList.remove('hidden');
        initializePeer();
    } else {
        alert('Vui lòng nhập đầy đủ thông tin đăng nhập!');
    }
}

// Sửa lại hàm quickConnect để không hiện thông báo "đang kết nối lại"
async function quickConnect() {
    const adminId = ADMIN_CREDENTIALS.peerId;
    if (adminId) {
        try {
            console.log('Kết nối nhanh với bác sĩ ID:', adminId);
            
            if (!peer || !peer.connected) {
                await initializePeer();
            }
            
            // User chỉ cần audio stream
            localStream = await navigator.mediaDevices.getUserMedia({
                video: false,
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 22050,
                    channelCount: 1
                }
            });
            
            const call = peer.call(adminId, localStream);
            handleCall(call);
        } catch (err) {
            console.error('Lỗi khi kết nối:', err);
            alert('Lỗi: ' + err.message);
            if (localStream) {
                localStream.getTracks().forEach(track => track.stop());
            }
        }
    }
}

// Thêm vào cuối file
window.onload = function() {
    document.getElementById('setup-box').classList.remove('hidden');
    if (!isAdmin) {
        initializePeer();
    }
}

function cancelWaiting() {
    // Kiểm tra xem user có trong hàng đợi không
    const myPeerId = peer.id;
    const index = waitingQueue.indexOf(myPeerId);
    
    if (index > -1) {
        // Xóa khỏi hàng đợi
        waitingQueue.splice(index, 1);
        
        // Thông báo cho admin về việc cập nhật hàng đợi
        if (ADMIN_CREDENTIALS.peerId) {
            const adminConn = peer.connect(ADMIN_CREDENTIALS.peerId);
            adminConn.on('open', () => {
                adminConn.send({
                    type: 'queue_update',
                    queue: waitingQueue
                });
            });
        }
        
        // Cập nhật vị trí cho các user còn lại
        waitingQueue.forEach((peerId, newIndex) => {
            const conn = peer.connect(peerId);
            conn.on('open', () => {
                conn.send({
                    type: 'waiting',
                    position: newIndex + 1
                });
            });
        });
    }
    
    // Reset UI cho user hiện tại
    document.getElementById('waiting-box').classList.add('hidden');
    document.getElementById('setup-box').classList.remove('hidden');
}

function showNextPatientButton() {
    const nextPatientBtn = document.getElementById('next-patient-btn');
    if (isAdmin && currentCall) {
        if (waitingQueue.length > 0) {
            nextPatientBtn.classList.remove('hidden');
            nextPatientBtn.textContent = `Bệnh nhân tiếp theo (${waitingQueue.length})`;
        } else {
            nextPatientBtn.classList.add('hidden');
        }
    } else {
        nextPatientBtn.classList.add('hidden');
    }
}

// Thêm hàm mới để đồng bộ hàng đợi
function syncWaitingQueue(removedPeerId) {
    // Xóa user đã ngắt kết nối khỏi hàng đợi
    const index = waitingQueue.indexOf(removedPeerId);
    if (index > -1) {
        waitingQueue.splice(index, 1);
        
        // Cập nhật vị trí cho các user còn lại trong hàng đợi
        waitingQueue.forEach((peerId, newIndex) => {
            const conn = peer.connect(peerId);
            conn.on('open', () => {
                conn.send({
                    type: 'waiting',
                    position: newIndex + 1
                });
            });
        });

        // Cập nhật UI cho admin nếu còn user trong hàng đợi
        if (isAdmin) {
            if (waitingQueue.length > 0) {
                const nextBtn = document.getElementById('next-patient-btn');
                nextBtn.classList.remove('hidden');
                nextBtn.textContent = `Gọi bệnh nhân tiếp theo (${waitingQueue.length})`;
            } else {
                document.getElementById('next-patient-btn').classList.add('hidden');
            }
        }
    }
}

// Thêm hàm kiểm tra kết nối của tất cả user trong hàng đợi
async function checkQueueConnections() {
    const disconnectedUsers = [];
    
    // Tạo bản sao của hàng đợi để kiểm tra
    const queueToCheck = [...waitingQueue];
    
    for (let i = 0; i < queueToCheck.length; i++) {
        const peerId = queueToCheck[i];
        try {
            const conn = peer.connect(peerId);
            let isConnected = false;
            
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Timeout'));
                }, 5000);

                conn.on('open', () => {
                    isConnected = true;
                    clearTimeout(timeout);
                    resolve();
                });

                conn.on('error', () => {
                    clearTimeout(timeout);
                    reject(new Error('Connection failed'));
                });
            });
        } catch (err) {
            console.log('Phát hiện user mất kết nối:', peerId);
            disconnectedUsers.push(peerId);
        }
    }
    
    // Chỉ xóa các user mất kết nối khỏi hàng đợi
    if (disconnectedUsers.length > 0) {
        waitingQueue = waitingQueue.filter(id => !disconnectedUsers.includes(id));
        
        // Cập nhật lại vị trí cho các user còn lại
        for (let i = 0; i < waitingQueue.length; i++) {
            try {
                const conn = peer.connect(waitingQueue[i]);
                conn.on('open', () => {
                    conn.send({
                        type: 'waiting',
                        position: i + 1
                    });
                });
            } catch (err) {
                console.error('Lỗi khi cập nhật vị trí:', err);
            }
        }
    }
    
    console.log('Số bệnh nhân còn lại trong hàng đợi:', waitingQueue.length);
    return waitingQueue.length;
}

// Sửa lại hàm nextPatient
async function nextPatient() {
    if (!isAdmin || waitingQueue.length === 0) return;
    
    // Kiểm tra và đồng bộ hàng đợi trước khi gọi bệnh nhân tiếp theo
    const remainingPatients = await checkQueueConnections();
    
    if (remainingPatients === 0) {
        console.log('Không còn bệnh nhân trong hàng đợi');
        document.getElementById('next-patient-btn').classList.add('hidden');
        return;
    }
    
    const nextPatientId = waitingQueue[0];
    console.log('Kiểm tra kết nối với bệnh nhân:', nextPatientId);
    
    try {
        const conn = peer.connect(nextPatientId);
        let isConnected = false;
        
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                if (!isConnected) {
                    reject(new Error('Timeout'));
                }
            }, 5000);

            conn.on('open', () => {
                isConnected = true;
                clearTimeout(timeout);
                resolve();
            });

            conn.on('error', (err) => {
                clearTimeout(timeout);
                reject(err);
            });
        });

        // Nếu kết nối thành công, xóa khỏi hàng đợi và bắt đầu cuộc gọi
        waitingQueue.shift();
        startNewCall(nextPatientId, conn);

    } catch (err) {
        console.error('Bệnh nhân không còn kết nối:', err);
        // Kiểm tra lại hàng đợi và thử gọi bệnh nhân tiếp theo
        await checkQueueConnections();
        if (waitingQueue.length > 0) {
            setTimeout(nextPatient, 1000);
        }
    }
}

// Thêm hàm mới để xử lý việc bắt đầu cuộc gọi mới
async function startNewCall(peerId, conn) {
    try {
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }

        // Admin sử dụng constraints có video
        localStream = await navigator.mediaDevices.getUserMedia(AUDIO_CONFIG);
        
        const localVideo = document.getElementById('local-video');
        localVideo.srcObject = localStream;
        await localVideo.play();

        if (conn) {
            conn.send({ type: 'called' });
        }

        if (peer && peer.connected) {
            console.log('Bắt đầu gọi tới:', peerId);
            const call = peer.call(peerId, localStream);
            
            call.on('stream', (remoteStream) => {
                // Admin chỉ cần xử lý audio từ user
                handleRemoteAudioOnly(remoteStream, peerId);
            });

            currentCall = call;
            currentUserId = peerId;
        }
    } catch (err) {
        console.error('Lỗi trong startNewCall:', err);
        alert('Không thể kết nối: ' + err.message);
    }
}

async function handleRemoteStream(remoteStream, peerId) {
    console.log('Xử lý remote stream từ:', peerId);
    
    try {
        const remoteVideo = document.getElementById('remote-video');
        
        // Đảm bảo video element được cấu hình đúng
        remoteVideo.autoplay = true;
        remoteVideo.playsInline = true;
        remoteVideo.muted = false;
        
        // Dọn dẹp stream cũ
        if (remoteVideo.srcObject) {
            const oldStream = remoteVideo.srcObject;
            remoteVideo.srcObject = null;
            oldStream.getTracks().forEach(track => track.stop());
        }

        // Set stream mới và đợi metadata
        remoteVideo.srcObject = remoteStream;
        await new Promise((resolve) => {
            remoteVideo.onloadedmetadata = resolve;
        });

        // Play video với retry
        try {
            await remoteVideo.play();
            console.log('Remote video đang phát');
        } catch (err) {
            console.error('Lỗi khi play video:', err);
            // Thử lại sau khi user tương tác
            document.body.addEventListener('click', async () => {
                try {
                    await remoteVideo.play();
                } catch (retryErr) {
                    console.error('Vẫn không thể phát video:', retryErr);
                }
            }, { once: true });
        }

        // Cập nhật UI
        document.getElementById('setup-box').classList.add('hidden');
        document.getElementById('call-box').classList.remove('hidden');
        updateControlButtons();
        if (isAdmin) {
            showNextPatientButton();
        }

    } catch (err) {
        console.error('Lỗi xử lý remote stream:', err);
    }
}

function handleRemoteAudioOnly(remoteStream, peerId) {
    console.log('Xử lý remote audio từ:', peerId);
    
    try {
        if (window.currentAudio) {
            window.currentAudio.pause();
            window.currentAudio.srcObject = null;
        }

        const audioElement = new Audio();
        audioElement.autoplay = true;
        audioElement.srcObject = remoteStream;
        
        // Cập nhật UI
        document.getElementById('setup-box').classList.add('hidden');
        document.getElementById('waiting-box').classList.add('hidden');
        document.getElementById('call-box').classList.remove('hidden');
        
        const statusDot = document.querySelector('.status-dot');
        const statusText = document.querySelector('.status-text');
        
        if (statusDot && statusText) {
            statusDot.classList.add('active');
            statusText.textContent = 'Đang trong cuộc gọi';
        }

        window.currentAudio = audioElement;
        
    } catch (err) {
        console.error('Lỗi xử lý audio:', err);
    }
}

function returnToClinic() {
    // Ẩn nút quay lại
    document.getElementById('return-btn').classList.add('hidden');
    // Hiện nút bệnh nhân tiếp theo nếu còn bệnh nhân trong hàng đợi
    if (waitingQueue.length > 0) {
        document.getElementById('next-patient-btn').classList.remove('hidden');
        document.getElementById('next-patient-btn').textContent = `Bệnh nhân tiếp theo (${waitingQueue.length})`;
    }
    // Reset UI
    document.getElementById('setup-box').classList.add('hidden');
    document.getElementById('call-box').classList.remove('hidden');
    // Gọi bệnh nhân tiếp theo
    nextPatient();
}

// Thêm hàm mới để cập nhật hiển thị các nút điều khiển
function updateControlButtons() {
    try {
        const callBox = document.getElementById('call-box');
        if (!callBox) return;

        const micBtn = document.getElementById('mic-btn');
        const endCallBtn = document.getElementById('end-call-btn');
        
        if (micBtn) {
            micBtn.textContent = isMicOn ? 'Tắt mic' : 'Bật mic';
        }
        
        if (endCallBtn) {
            endCallBtn.classList.remove('hidden');
        }
    } catch (err) {
        console.error('Lỗi cập nhật nút điều khiển:', err);
    }
}

async function getLocalStreamWithRetry(maxRetries = 3) {
    let lastError;
    
    for (let i = 0; i < maxRetries; i++) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 320 },
                    height: { ideal: 240 },
                    frameRate: { ideal: 15 }
                },
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            return stream;
        } catch (err) {
            console.error(`Lỗi getUserMedia lần ${i + 1}:`, err);
            lastError = err;
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    throw lastError;
}

async function initializeStream() {
    try {
        // Kiểm tra quyền truy cập microphone
        const permissions = await navigator.mediaDevices.getUserMedia({ audio: true });
        permissions.getTracks().forEach(track => track.stop());

        // Khởi tạo stream
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: AUDIO_CONFIG
        });

        // Kiểm tra stream
        const audioTracks = stream.getAudioTracks();
        if (!audioTracks.length) {
            throw new Error('Không thể khởi tạo audio stream');
        }

        // Bật mic mặc định
        audioTracks[0].enabled = true;
        
        return stream;

    } catch (err) {
        console.error('Lỗi khởi tạo audio stream:', err);
        if (err.name === 'NotAllowedError') {
            alert('Vui lòng cho phép truy cập microphone để thực hiện cuộc gọi');
        } else {
            alert('Không thể kết nối microphone: ' + err.message);
        }
        throw err;
    }
}

async function checkAudioDevices() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioDevices = devices.filter(device => device.kind === 'audioinput');
        
        if (audioDevices.length === 0) {
            throw new Error('Không tìm thấy thiết bị microphone');
        }
        
        return true;
    } catch (err) {
        console.error('Lỗi kiểm tra thiết bị âm thanh:', err);
        return false;
    }
}

async function initializeAdmin() {
    try {
        isAdmin = true;
        console.log('[DEBUG] Khởi tạo admin');
        
        // Kiểm tra và khởi tạo audio
        const hasAudio = await checkAudioDevices();
        if (!hasAudio) {
            throw new Error('Không tìm thấy thiết bị âm thanh');
        }

        // Khởi tạo stream trước
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: AUDIO_CONFIG
        });

        // Sau đó mới khởi tạo peer
        await initializePeer();
        
        return true;
    } catch (err) {
        console.error('[DEBUG] Lỗi khởi tạo admin:', err);
        alert('Lỗi khởi tạo: ' + err.message);
        return false;
    }
}

function setupCallHandlers() {
    if (!peer) return;

    peer.on('call', async (call) => {
        console.log('[DEBUG] Admin nhận cuộc gọi từ:', call.peer);
        
        try {
            if (!localStream || localStream.getTracks().length === 0) {
                console.log('[DEBUG] Khởi tạo lại stream cho admin');
                localStream = await navigator.mediaDevices.getUserMedia({
                    audio: AUDIO_CONFIG
                });
            }

            console.log('[DEBUG] Trả lời cuộc gọi');
            call.answer(localStream);

            call.on('stream', (remoteStream) => {
                console.log('[DEBUG] Nhận được remote stream');
                handleRemoteAudioOnly(remoteStream, call.peer);
            });

            call.on('error', (err) => {
                console.error('[DEBUG] Lỗi cuộc gọi:', err);
                endCall();
            });

            call.on('close', () => {
                console.log('[DEBUG] Cuộc gọi kết thúc');
                endCall();
            });

            currentCall = call;
            updateCallUI(true);

        } catch (err) {
            console.error('[DEBUG] Lỗi xử lý cuộc gọi:', err);
            call.close();
            alert('Lỗi kết nối cuộc gọi: ' + err.message);
        }
    });
}

function updateCallUI(isInCall) {
    try {
        const setupBox = document.getElementById('setup-box');
        const callBox = document.getElementById('call-box');
        const statusText = document.querySelector('.status-text');
        const statusDot = document.querySelector('.status-dot');

        if (setupBox) setupBox.classList.toggle('hidden', isInCall);
        if (callBox) callBox.classList.toggle('hidden', !isInCall);
        
        if (statusText && statusDot && isInCall) {
            statusText.textContent = 'Đang trong cuộc gọi';
            statusDot.classList.add('active');
        }
        
        updateControlButtons();
    } catch (err) {
        console.error('[DEBUG] Lỗi cập nhật UI:', err);
    }
}