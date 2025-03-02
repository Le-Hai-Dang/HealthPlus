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

const mediaConstraints = {
    video: false,
    audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 48000,
        channelCount: 1,
        latency: 0,
        volume: 1.0
    }
};

// Thêm constraints riêng cho admin
const adminMediaConstraints = {
    video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 15 }
    },
    audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
    }
};

async function initializePeer() {
    console.log("Initializing peer...");
    
    // Hủy peer cũ nếu có
    if (peer) {
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
            peer = new Peer('doctor123', peerConfig);
        } else {
            peer = new Peer(peerConfig); // User thường dùng random ID
        }

        // Xử lý sự kiện mở kết nối
        peer.on('open', (id) => {
            console.log('Peer ID của tôi là:', id);
            if (isAdmin) {
                adminPeerId = id;
                document.getElementById('admin-id').textContent = id;
            }
        });

        // Xử lý lỗi
        peer.on('error', (error) => {
            console.error('Lỗi PeerJS:', error);
            if (error.type === 'unavailable-id') {
                alert('ID bác sĩ đã được sử dụng, vui lòng thử lại sau');
                peer.destroy();
                setTimeout(initializePeer, 5000);
                return;
            }
            if (error.type === 'peer-unavailable') {
                alert('Không tìm thấy người dùng này');
                return;
            }
        });

        // Xử lý ngắt kết nối
        peer.on('disconnected', () => {
            console.log('Mất kết nối với server');
            if (!peer.destroyed) {
                peer.reconnect();
            }
        });

        // Đợi kết nối thành công
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timeout kết nối'));
            }, 10000);

            peer.on('open', () => {
                clearTimeout(timeout);
                resolve();
            });
        });

    } catch (err) {
        console.error('Lỗi khởi tạo peer:', err);
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
    if (currentCall) {
        currentCall.close();
        currentCall = null;
    }
    
    if (window.currentAudio) {
        window.currentAudio.pause();
        window.currentAudio.srcObject = null;
        window.currentAudio = null;
    }

    document.getElementById('call-box').classList.add('hidden');
    document.getElementById('setup-box').classList.remove('hidden');
    document.querySelector('.status-dot').classList.remove('active');
    document.querySelector('.status-text').textContent = 'Đang gọi...';
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
        localStream = await navigator.mediaDevices.getUserMedia(adminMediaConstraints);
        
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

        // Cấu hình audio cho cả admin và user
        const audioConfig = {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 44100,
            channelCount: 1,
            latency: 0,
            volume: 1.0
        };

        // Khởi tạo stream
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: audioConfig
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