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

const peerConfig = {
    host: '0.peerjs.com',
    port: 443,
    secure: true,
    debug: 0,
    config: {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ],
        iceTransportPolicy: 'all',
        bundlePolicy: 'max-bundle',
        iceCandidatePoolSize: 1
    }
};

const mediaConstraints = {
    video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { max: 15 },
        facingMode: 'user'
    },
    audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 22050,
        channelCount: 1
    }
};

async function initializePeer() {
    if (peer) {
        peer.destroy();
        peer = null;
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (isAdmin) {
        peer = new Peer(ADMIN_CREDENTIALS.peerId, peerConfig);
    } else {
        peer = new Peer(peerConfig);
    }

    peer.on('open', (id) => {
        console.log("Connected with ID:", id);
        document.getElementById('my-peer-id').textContent = id;
        if (isAdmin) {
            adminPeerId = id;
            localStorage.setItem('adminPeerId', id);
        }
    });

    peer.on('error', (error) => {
        console.error('PeerJS error:', error.type);
        if (error.type === 'peer-unavailable') {
            alert('Không thể kết nối với người dùng này');
        }
    });

    peer.on('disconnected', () => {
        console.log('Disconnected from server');
        endCall();
    });

    peer.on('call', async (call) => {
        console.log('Có cuộc gọi đến từ:', call.peer);
        
        try {
            if (isAdmin) {
                if (currentCall) {
                    // Nếu đang có cuộc gọi, thêm vào hàng đợi
                    waitingQueue.push(call.peer);
                    const conn = peer.connect(call.peer);
                    await new Promise(resolve => {
                        conn.on('open', () => {
                            conn.send({
                                type: 'waiting',
                                position: waitingQueue.length
                            });
                            resolve();
                        });
                    });
                    call.close();
                    showNextPatientButton();
                    return;
                }

                currentUserId = call.peer;
                localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
            } else {
                localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
            }

            document.getElementById('local-video').srcObject = localStream;
            call.answer(localStream);
            handleCall(call);

        } catch (err) {
            console.error('Lỗi khi xử lý cuộc gọi đến:', err);
            if (call) call.close();
            alert('Không thể truy cập camera hoặc microphone');
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
        if (!peer || !peer.connected) {
            await initializePeer();
            // Đợi peer kết nối
            await new Promise((resolve) => {
                const timeout = setTimeout(() => resolve(), 5000);
                peer.on('open', () => {
                    clearTimeout(timeout);
                    resolve();
                });
            });
        }

        localStream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 640 },
                height: { ideal: 480 },
                frameRate: { max: 15 }
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true
            }
        });
        
        document.getElementById('local-video').srcObject = localStream;
        
        const call = peer.call(peerId, localStream);
        if (call) {
            handleCall(call);
        } else {
            throw new Error('Không thể tạo cuộc gọi');
        }
    } catch (err) {
        console.error('Lỗi khi kết nối:', err);
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }
        alert('Không thể kết nối: ' + err.message);
    }
}

function handleCall(call) {
    if (currentCall) {
        currentCall.close();
    }
    currentCall = call;
    
    document.getElementById('setup-box').classList.add('hidden');
    document.getElementById('call-box').classList.remove('hidden');
    
    let streamTimeout = setTimeout(() => {
        console.error('Timeout waiting for stream');
        endCall();
    }, 10000);

    call.on('stream', (remoteStream) => {
        clearTimeout(streamTimeout);
        const remoteVideo = document.getElementById('remote-video');
        if (remoteVideo) {
            remoteVideo.srcObject = remoteStream;
        }
    });

    call.on('close', () => {
        clearTimeout(streamTimeout);
        endCall();
    });

    call.on('error', (err) => {
        clearTimeout(streamTimeout);
        console.error('Call error:', err);
        endCall();
    });

    if (isAdmin) {
        showNextPatientButton();
    }
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
        try {
            currentCall.close();
        } catch (err) {
            console.error('Error closing call');
        }
        currentCall = null;
    }
    
    if (localStream) {
        try {
            localStream.getTracks().forEach(track => {
                track.stop();
            });
        } catch (err) {
            console.error('Error stopping tracks');
        }
        localStream = null;
    }
    
    document.getElementById('call-box').classList.add('hidden');
    document.getElementById('setup-box').classList.remove('hidden');
    document.getElementById('local-video').srcObject = null;
    document.getElementById('remote-video').srcObject = null;
    
    currentUserId = null;
    showNextPatientButton();
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
    try {
        if (!peer || !peer.connected) {
            await initializePeer();
            // Đợi peer kết nối
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);
                peer.on('open', () => {
                    clearTimeout(timeout);
                    resolve();
                });
            });
        }

        // Lấy stream trước khi gọi
        localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
        document.getElementById('local-video').srcObject = localStream;

        // Kết nối với admin (doctor123)
        const call = peer.call('doctor123', localStream);
        if (!call) {
            throw new Error('Không thể tạo cuộc gọi');
        }
        handleCall(call);

    } catch (err) {
        console.error('Lỗi khi kết nối nhanh:', err);
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }
        alert('Không thể kết nối với bác sĩ. Vui lòng thử lại sau.');
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
        // Thông báo cho user được gọi trước
        conn.send({
            type: 'called'
        });

        // Đợi một chút để user chuẩn bị
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Khởi tạo stream mới trước khi đóng cuộc gọi cũ
        localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });

        // Sau khi có stream mới mới đóng cuộc gọi cũ
        if (currentCall) {
            currentCall.close();
            currentCall = null;
        }

        // Reset video elements
        document.getElementById('remote-video').srcObject = null;
        document.getElementById('local-video').srcObject = localStream;
        
        if (peer && peer.connected) {
            const call = peer.call(peerId, localStream);
            
            // Thêm timeout dài hơn cho việc thiết lập cuộc gọi
            const callTimeout = setTimeout(() => {
                if (!currentCall) {
                    console.error('Không thể thiết lập cuộc gọi');
                    endCall();
                }
            }, 15000);
            
            call.on('stream', (remoteStream) => {
                clearTimeout(callTimeout);
                document.getElementById('remote-video').srcObject = remoteStream;
                // Cập nhật UI sau khi nhận được stream
                document.getElementById('setup-box').classList.add('hidden');
                document.getElementById('call-box').classList.remove('hidden');
                updateControlButtons();
                showNextPatientButton();
            });
            
            call.on('close', () => {
                console.log('Cuộc gọi kết thúc');
                clearTimeout(callTimeout);
            });
            
            currentCall = call;
            currentUserId = peerId;
        }
    } catch (err) {
        console.error('Lỗi khi bắt đầu cuộc gọi mới:', err);
        // Không gọi endCall() ngay mà thử lại
        if (waitingQueue.length > 0) {
            setTimeout(nextPatient, 1000);
        }
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