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
            urls: 'turn:a.relay.metered.ca:80',
            username: 'e8c7e8e14b95e7e12d6f7592',  // Thay bằng credentials thực
            credential: 'UAK0JrYJxNgA5cZe'
        },
        {
            urls: 'turn:a.relay.metered.ca:443',
            username: 'e8c7e8e14b95e7e12d6f7592',
            credential: 'UAK0JrYJxNgA5cZe'
        }
    ],
    iceCandidatePoolSize: 10,
    iceTransportPolicy: 'relay' // Bắt buộc sử dụng TURN server
};

const mediaConstraints = {
    video: {
        width: { min: 320, ideal: 640, max: 854 },
        height: { min: 240, ideal: 480, max: 480 },
        frameRate: { min: 10, ideal: 15, max: 24 },
        facingMode: 'user'
    },
    audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
    }
};

async function initializePeer() {
    console.log("Initializing peer...");
    
    // Đóng kết nối cũ nếu có
    if (peer) {
        peer.destroy();
        await new Promise(resolve => setTimeout(resolve, 1000)); // Đợi 1s để đảm bảo kết nối cũ đã đóng
    }
    
    const peerConfig = {
        host: '0.peerjs.com',
        port: 443,
        secure: true,
        debug: 3,
        config: ICE_SERVERS,
        reconnectTimer: 1000,
        retries: 3
    };

    if (isAdmin) {
        peer = new Peer(ADMIN_CREDENTIALS.peerId, peerConfig);
    } else {
        peer = new Peer(peerConfig);
    }

    peer.on('open', (id) => {
        console.log("Peer ID của tôi là:", id);
        document.getElementById('my-peer-id').textContent = id;
        peer.connected = true;
        if (isAdmin) {
            adminPeerId = id;
            localStorage.setItem('adminPeerId', id);
        }
        updateControlButtons();
    });

    peer.on('error', (error) => {
        console.error('Lỗi PeerJS:', error);
        peer.connected = false;
        
        if (error.type === 'peer-unavailable' || error.type === 'disconnected') {
            setTimeout(() => {
                if (!peer.connected) {
                    initializePeer();
                }
            }, 5000);
        }
    });

    peer.on('disconnected', () => {
        console.log('Mất kết nối với server');
        peer.connected = false;
        
        // Đợi 1s trước khi thử reconnect
        setTimeout(() => {
            if (!peer.destroyed) {
                peer.reconnect();
            }
        }, 1000);
    });

    peer.on('call', async (call) => {
        console.log('Có cuộc gọi đến từ:', call.peer);
        
        try {
            if (isAdmin) {
                console.log('Admin nhận cuộc gọi mới');
                if (currentCall) {
                    console.log('Đã có cuộc gọi, thêm vào hàng đợi:', call.peer);
                    waitingQueue.push(call.peer);
                    const conn = peer.connect(call.peer);
                    conn.on('open', () => {
                        conn.send({
                            type: 'waiting',
                            position: waitingQueue.length
                        });
                    });
                    call.close();
                    showNextPatientButton();
                    return;
                }
                currentUserId = call.peer;
            }

            // Khởi tạo stream mới
            if (!localStream) {
                localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
                
                console.log('Đã có local stream, hiển thị video local');
                const localVideo = document.getElementById('local-video');
                localVideo.srcObject = localStream;
                await localVideo.play().catch(e => console.error('Lỗi khi play local video:', e));
            }

            console.log('Trả lời cuộc gọi với local stream');
            call.answer(localStream);
            
            call.on('stream', (remoteStream) => {
                console.log('Nhận được remote stream');
                handleRemoteStream(remoteStream, call.peer);
            });

            call.on('error', (err) => {
                console.error('Lỗi cuộc gọi:', err);
                endCall();
            });

            call.on('close', () => {
                console.log('Cuộc gọi đã kết thúc');
                endCall(); 
            });

            currentCall = call;

        } catch (err) {
            console.error('Lỗi khi xử lý cuộc gọi đến:', err);
            call.close();
            alert('Không thể truy cập camera hoặc microphone: ' + err.message);
        }
    });

    // Thêm xử lý sự kiện connection
    peer.on('connection', (conn) => {
        conn.on('data', (data) => {
            if (data.type === 'waiting') {
                document.getElementById('waiting-box').classList.remove('hidden');
                document.getElementById('setup-box').classList.add('hidden');
                document.getElementById('call-box').classList.add('hidden');
                document.getElementById('queue-position').textContent = data.position;
            } else if (data.type === 'called') {
                document.getElementById('waiting-box').classList.add('hidden');
                document.getElementById('call-box').classList.remove('hidden');
            } else if (data.type === 'queue_update' && isAdmin) {
                waitingQueue = data.queue;
                showNextPatientButton();
                // Thêm log để debug
                console.log('Hàng đợi đã được cập nhật:', waitingQueue);
            }
        });
    });
}

async function connectToPeer(peerId) {
    if (!peerId) {
        peerId = document.getElementById('peer-id-input').value;
    }
    
    if (!peerId) {
        alert('Vui lòng nhập Peer ID');
        return;
    }

    try {
        // Dọn dẹp stream cũ
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }

        // Khởi tạo stream mới
        localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
        
        // Hiển thị local video
        const localVideo = document.getElementById('local-video');
        localVideo.srcObject = localStream;
        await localVideo.play();

        if (!peer || !peer.connected) {
            throw new Error('Chưa kết nối tới server');
        }

        console.log('Bắt đầu gọi tới:', peerId);
        const call = peer.call(peerId, localStream);
        
        // Xử lý stream từ người được gọi
        call.on('stream', (remoteStream) => {
            console.log('Nhận được remote stream');
            handleRemoteStream(remoteStream, peerId);
        });

        // Xử lý lỗi
        call.on('error', (err) => {
            console.error('Lỗi cuộc gọi:', err);
            endCall();
        });

        // Xử lý đóng cuộc gọi
        call.on('close', () => {
            console.log('Cuộc gọi đã kết thúc');
            endCall();
        });

        currentCall = call;
        currentUserId = peerId;

    } catch (err) {
        console.error('Lỗi khi kết nối:', err);
        alert('Không thể kết nối: ' + err.message);
    }
}

function handleCall(call) {
    currentCall = call;
    let streamProcessing = false;

    // Theo dõi trạng thái kết nối ICE
    call.peerConnection.oniceconnectionstatechange = () => {
        const state = call.peerConnection.iceConnectionState;
        console.log('Trạng thái ICE:', state);
        
        if (state === 'failed' || state === 'disconnected') {
            console.log('Kết nối ICE thất bại hoặc bị ngắt');
            call.peerConnection.restartIce();
        }
    };

    // Xử lý remote stream
    call.on('stream', async (remoteStream) => {
        console.log('Nhận được remote stream');
        
        // Tránh xử lý đồng thời nhiều stream
        if (streamProcessing) {
            console.log('Đang xử lý stream khác, bỏ qua');
            return;
        }
        
        streamProcessing = true;
        
        try {
            const remoteVideo = document.getElementById('remote-video');
            
            // Dọn dẹp stream cũ
            if (remoteVideo.srcObject) {
                const oldStream = remoteVideo.srcObject;
                remoteVideo.srcObject = null;
                oldStream.getTracks().forEach(track => track.stop());
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            // Thiết lập stream mới
            remoteVideo.srcObject = remoteStream;
            
            // Đợi video load xong
            await new Promise(resolve => {
                remoteVideo.onloadedmetadata = resolve;
            });
            
            // Play video
            await remoteVideo.play();
            console.log('Remote video đang phát');
            
        } catch (err) {
            console.error('Lỗi khi xử lý remote stream:', err);
            
            // Thử lại sau 1 giây nếu lỗi
            setTimeout(async () => {
                try {
                    const remoteVideo = document.getElementById('remote-video');
                    await remoteVideo.play();
                    console.log('Remote video phát thành công sau khi thử lại');
                } catch (retryErr) {
                    console.error('Không thể phát video sau khi thử lại:', retryErr);
                }
            }, 1000);
            
        } finally {
            streamProcessing = false;
        }
    });

    // Cập nhật UI
    document.getElementById('setup-box').classList.add('hidden');
    document.getElementById('call-box').classList.remove('hidden');
    updateControlButtons();
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
    
    if (localStream) {
        localStream.getTracks().forEach(track => {
            track.stop();
            localStream.removeTrack(track);
        });
        localStream = null;
    }
    
    const localVideo = document.getElementById('local-video');
    const remoteVideo = document.getElementById('remote-video');
    
    if (localVideo.srcObject) {
        localVideo.srcObject = null;
        localVideo.load();
    }
    
    if (remoteVideo.srcObject) {
        remoteVideo.srcObject = null;
        remoteVideo.load();
    }
    
    currentUserId = null;
    document.getElementById('call-box').classList.add('hidden');
    document.getElementById('setup-box').classList.remove('hidden');
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
            
            localStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            
            document.getElementById('local-video').srcObject = localStream;
            const call = peer.call(adminId, localStream);
            
            // Xử lý khi cuộc gọi bị đóng ngay lập tức (do bác sĩ đang bận)
            call.on('close', () => {
                if (!document.getElementById('waiting-box').classList.contains('hidden')) {
                    // Nếu đang ở trạng thái chờ thì không làm gì
                    return;
                }
                // Nếu không phải do waiting box, reset lại giao diện
                document.getElementById('local-video').srcObject = null;
                localStream.getTracks().forEach(track => track.stop());
            });

            handleCall(call);
        } catch (err) {
            console.error('Lỗi khi kết nối:', err);
            alert('Lỗi: ' + err.message);
            if (localStream) {
                localStream.getTracks().forEach(track => track.stop());
            }
        }
    } else {
        alert('Không tìm thấy bác sĩ trực tuyến, vui lòng thử lại sau');
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
        // Dọn dẹp tài nguyên cũ
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }

        // Khởi tạo stream mới
        localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
        
        // Hiển thị local video
        const localVideo = document.getElementById('local-video');
        localVideo.srcObject = localStream;
        await localVideo.play();

        // Thông báo cho user được gọi
        if (conn) {
            conn.send({ type: 'called' });
        }

        // Tạo cuộc gọi mới
        if (peer && peer.connected) {
            console.log('Bắt đầu gọi tới:', peerId);
            const call = peer.call(peerId, localStream);
            
            // Xử lý stream từ người được gọi
            call.on('stream', (remoteStream) => {
                console.log('Nhận được remote stream');
                handleRemoteStream(remoteStream, peerId);
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
        // Kiểm tra tracks
        const videoTracks = remoteStream.getVideoTracks();
        const audioTracks = remoteStream.getAudioTracks();
        console.log('Video tracks:', videoTracks.length);
        console.log('Audio tracks:', audioTracks.length);

        // Lấy video element
        const remoteVideo = document.getElementById('remote-video');
        if (!remoteVideo) {
            throw new Error('Không tìm thấy remote-video element');
        }

        // Cấu hình video element
        remoteVideo.autoplay = true;
        remoteVideo.playsInline = true;
        remoteVideo.muted = false;

        // Set stream mới
        remoteVideo.srcObject = remoteStream;

        // Đợi metadata với timeout ngắn hơn
        try {
            await Promise.race([
                new Promise((resolve) => {
                    remoteVideo.onloadedmetadata = () => {
                        console.log('Metadata đã load xong');
                        resolve();
                    };
                }),
                new Promise((_, reject) => {
                    setTimeout(() => {
                        console.log('Bỏ qua đợi metadata, thử play video');
                        resolve();
                    }, 2000);
                })
            ]);

            // Play video ngay lập tức
            await remoteVideo.play();
            console.log('Remote video đang phát');

        } catch (playError) {
            console.error('Lỗi khi play video:', playError);
            
            // Thử play lại ngay
            try {
                await remoteVideo.play();
                console.log('Video đã play sau khi thử lại');
            } catch (retryErr) {
                console.error('Vẫn không thể phát video:', retryErr);
                
                // Thử lần cuối khi user tương tác
                document.addEventListener('click', async () => {
                    try {
                        await remoteVideo.play();
                        console.log('Video đã play sau khi user tương tác');
                    } catch (e) {
                        console.error('Không thể phát video:', e);
                    }
                }, { once: true });
            }
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
    const endCallBtn = document.getElementById('end-call-btn');
    const nextPatientBtn = document.getElementById('next-patient-btn');
    
    if (isAdmin) {
        endCallBtn.classList.remove('hidden');
        // Chỉ hiện nút next nếu có người trong hàng đợi
        if (waitingQueue.length > 0) {
            nextPatientBtn.classList.remove('hidden');
            nextPatientBtn.textContent = `Bệnh nhân tiếp theo (${waitingQueue.length})`;
        } else {
            nextPatientBtn.classList.add('hidden');
        }
    } else {
        endCallBtn.classList.add('hidden');
        nextPatientBtn.classList.add('hidden');
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